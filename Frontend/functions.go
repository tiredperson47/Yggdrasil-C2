package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"github.com/go-sql-driver/mysql"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/argon2"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var DB *sql.DB
var Ctx = context.Background()
var R *redis.Client
var ArgonSalt []byte

var noteStore = struct {
	sync.RWMutex
	data map[string]string
}{
	data: make(map[string]string),
}

var commandLogStore = struct {
	sync.RWMutex
	data []CommandLog
}{
	data: make([]CommandLog, 0),
}

type Agent struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Hostname        string `json:"hostname"`
	IP              string `json:"ip"`
	Status          string `json:"status"`
	LastSeen        string `json:"lastSeen"`
	Notes           string `json:"notes"`
	OperatingSystem string `json:"operatingSystem"`
	Profile         string `json:"profile"`
	User            string `json:"user"`
	Sleep           int    `json:"sleep"`
	Process         string `json:"process"`
	PID             int    `json:"pid"`
	Arch            string `json:"arch"`
}

type CommandLog struct {
	ID        string `json:"id"`
	UserID    string `json:"userId"`
	Username  string `json:"username"`
	AgentID   string `json:"agentId"`
	Command   string `json:"command"`
	Timestamp string `json:"timestamp"`
}

type PublicFile struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Path      string `json:"path"`
	SizeBytes int64  `json:"sizeBytes"`
	BaseURL   string `json:"baseUrl"`
	URL       string `json:"url"`
	CreatedAt string `json:"createdAt"`
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

type AdminPayload struct {
	UUID    string `json:"uuid"`
	Command string `json:"command"`
}

type CompileConfig struct {
	CompileID        string   `json:"compileId"`
	AgentProfile     string   `json:"agentProfile"`
	Architecture     string   `json:"architecture"`
	OS               string   `json:"os"`
	Language         string   `json:"language"`
	Wrapper          string   `json:"wrapper"`
	Commands         []string `json:"commands"`
	RequiredCommands []string `json:"requiredCommands"`
	Listener         string   `json:"listener"`
	UseAES           int      `json:"useAES"`
	OutputType       string   `json:"outputType"`
	OutputFileName   string   `json:"outputFileName"`
	WrapperArgs      string   `json:"wrapperArgs"`
}

var httpTransport = &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}
var httpClient = &http.Client{Transport: httpTransport, Timeout: 8 * time.Second}
var deployClient = &http.Client{Transport: httpTransport, Timeout: 2 * time.Minute}

func init() {
	var err error
	useCustomTLS := false
	err = godotenv.Load("/app/.env")
	if err != nil {
		_ = godotenv.Load("../Handlers/.env")
	}
	_ = godotenv.Load()

	dbUser := os.Getenv("DB_USER")
	dbPass := os.Getenv("DB_PASS")
	database := os.Getenv("DATABASE")
	dockerDB := os.Getenv("DOCKER_DB")
	redisHost := os.Getenv("REDIS_HOST")
	redisPass := os.Getenv("REDIS_PASS")
	dbHost := os.Getenv("DB_HOST")

	if strings.EqualFold(dockerDB, "true") {
		dbHost = "mariadb"
	}
	if redisHost == "" {
		redisHost = os.Getenv("YGG_CORE")
	}
	if redisHost == "" {
		redisHost = "127.0.0.1"
	}
	if dbHost == "" {
		dbHost = "127.0.0.1"
	}

	caPath := "certs/ca.crt"
	crtPath := "certs/client.crt"
	keyPath := "certs/client.key"
	if _, statErr := os.Stat(caPath); statErr != nil {
		caPath = "../Handlers/nginx/certs/ca.crt"
		crtPath = "../Handlers/nginx/certs/client.crt"
		keyPath = "../Handlers/nginx/certs/client.key"
	}

	if _, statErr := os.Stat(caPath); statErr == nil {
		caCert, readErr := os.ReadFile(caPath)
		if readErr != nil {
			log.Println(readErr)
		} else {
			certPool := x509.NewCertPool()
			certPool.AppendCertsFromPEM(caCert)

			clientCert, certErr := tls.LoadX509KeyPair(crtPath, keyPath)
			if certErr != nil {
				log.Println(certErr)
			} else {
				tlsConfig := &tls.Config{
					RootCAs:      certPool,
					Certificates: []tls.Certificate{clientCert},
				}
				if regErr := mysql.RegisterTLSConfig("custom", tlsConfig); regErr != nil {
					log.Println(regErr)
				} else {
					useCustomTLS = true
				}
			}
		}
	}

	dsn := fmt.Sprintf("%v:%v@tcp(%v:3306)/%v?parseTime=true", dbUser, dbPass, dbHost, database)
	if useCustomTLS {
		dsn += "&tls=custom"
	}

	DB, err = sql.Open("mysql", dsn)
	if err != nil {
		log.Println("Failed to connect to database:", err)
		return
	}
	DB.SetMaxOpenConns(20)
	DB.SetMaxIdleConns(5)
	DB.SetConnMaxLifetime(time.Minute * 30)

	if err = DB.Ping(); err != nil {
		log.Println("Database ping failed:", err)
		DB = nil
	}

	R = redis.NewClient(&redis.Options{
		Addr:     redisHost + ":6379",
		DB:       0,
		Username: "default",
		Password: redisPass,
	})

	if _, err := R.Ping(Ctx).Result(); err != nil {
		log.Println("Redis client failed to connect:", err)
		R = nil
	}

	ArgonSalt = []byte(os.Getenv("SALT"))
	if len(ArgonSalt) == 0 {
		log.Println("SALT environment variable is missing; password verification will fail")
	}

}

// hashPassword hashes a password using argon2id
func hashPassword(password string) (string, error) {
	if len(ArgonSalt) == 0 {
		return "", errors.New("missing SALT environment variable")
	}
	hash := argon2.IDKey([]byte(password), ArgonSalt, 2, 16*1024, 4, 32)

	// Encode to Hex instead of Base64
	return hex.EncodeToString(hash), nil
}

// verifyPassword verifies a password against its hash
func verifyPassword(password string, hash string) (bool, error) {
	if len(ArgonSalt) == 0 {
		return false, errors.New("missing SALT environment variable")
	}
	computedHash := argon2.IDKey([]byte(password), ArgonSalt, 2, 16*1024, 4, 32)

	// Encode to Hex instead of Base64
	computedHashStr := hex.EncodeToString(computedHash)
	return computedHashStr == hash, nil
}

// User struct for database operations
type User struct {
	ID        int    `json:"id"`
	Username  string `json:"username"`
	Password  string `json:"password,omitempty"` // omitted when returned to frontend
	Role      string `json:"role"`
	CreatedAt string `json:"createdAt"`
}

// createUser creates a new operator in the database
func createUser(username string, password string, role string) error {
	if DB == nil {
		return errors.New("database not connected")
	}
	if strings.TrimSpace(username) == "" || strings.TrimSpace(password) == "" {
		return errors.New("username and password required")
	}
	if role != "admin" && role != "operator" {
		role = "operator"
	}

	// Check if user already exists
	var existingID int
	err := DB.QueryRow("SELECT id FROM operators WHERE username = ?", username).Scan(&existingID)
	if err == nil {
		return errors.New("user already exists")
	}
	if err != sql.ErrNoRows {
		return err
	}

	// Hash password
	hashedPassword, err := hashPassword(password)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	// Insert into database
	_, err = DB.Exec("INSERT INTO operators (username, password, role, created_at) VALUES (?, ?, ?, NOW())",
		username, hashedPassword, role)
	if err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}

	return nil
}

// verifyUser verifies username and password, returns user if valid
func verifyUser(username string, password string) (*User, error) {
	if DB == nil {
		return nil, errors.New("database not connected")
	}

	var user User
	var hashedPassword string
	var createdAt sql.NullTime

	err := DB.QueryRow("SELECT id, username, password, role, created_at FROM operators WHERE username = ?", username).
		Scan(&user.ID, &user.Username, &hashedPassword, &user.Role, &createdAt)

	if err == sql.ErrNoRows {
		return nil, errors.New("invalid username or password")
	}
	if err != nil {
		return nil, err
	}

	// Verify password
	valid, err := verifyPassword(password, hashedPassword)
	if err != nil {
		return nil, err
	}
	if !valid {
		return nil, errors.New("invalid username or password")
	}

	if createdAt.Valid {
		user.CreatedAt = createdAt.Time.UTC().Format(time.RFC3339)
	}

	return &user, nil
}

// getAllUsers returns all users from database (without passwords)
func getAllUsers() ([]User, error) {
	if DB == nil {
		return nil, errors.New("database not connected")
	}

	rows, err := DB.Query("SELECT id, username, role, created_at FROM operators ORDER BY id ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := make([]User, 0)
	for rows.Next() {
		var user User
		var createdAt sql.NullTime
		if err := rows.Scan(&user.ID, &user.Username, &user.Role, &createdAt); err != nil {
			return nil, err
		}
		if createdAt.Valid {
			user.CreatedAt = createdAt.Time.UTC().Format(time.RFC3339)
		}
		users = append(users, user)
	}

	return users, nil
}

// deleteUser deletes a user from the database
func deleteUser(userID int) error {
	if DB == nil {
		return errors.New("database not connected")
	}

	result, err := DB.Exec("DELETE FROM operators WHERE id = ?", userID)
	if err != nil {
		return err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return errors.New("user not found")
	}

	return nil
}

// validatePassword checks if password meets security requirements
// Must be at least 10 characters with uppercase, lowercase, numbers, and special characters
func validatePassword(password string) error {
	if len(password) < 10 {
		return errors.New("password must be at least 10 characters long")
	}

	hasUpper := false
	hasLower := false
	hasNumber := false
	hasSpecial := false

	for _, char := range password {
		switch {
		case char >= 'A' && char <= 'Z':
			hasUpper = true
		case char >= 'a' && char <= 'z':
			hasLower = true
		case char >= '0' && char <= '9':
			hasNumber = true
		default:
			hasSpecial = true
		}
	}

	if !hasUpper {
		return errors.New("password must contain at least one uppercase letter")
	}
	if !hasLower {
		return errors.New("password must contain at least one lowercase letter")
	}
	if !hasNumber {
		return errors.New("password must contain at least one number")
	}
	if !hasSpecial {
		return errors.New("password must contain at least one special character")
	}

	return nil
}

// changePassword updates a user's password
func changePassword(userID int, newPassword string) error {
	if DB == nil {
		return errors.New("database not connected")
	}

	// Validate new password
	if err := validatePassword(newPassword); err != nil {
		return err
	}

	// Hash the new password
	hashedPassword, err := hashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	// Update the password in database
	result, err := DB.Exec("UPDATE operators SET password = ? WHERE id = ?", hashedPassword, userID)
	if err != nil {
		return err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return errors.New("user not found")
	}

	return nil
}

func getUserByID(userID int) (*User, error) {
	if DB == nil {
		return nil, errors.New("database not connected")
	}

	var user User
	var createdAt sql.NullTime
	if err := DB.QueryRow("SELECT id, username, role, created_at FROM operators WHERE id = ?", userID).
		Scan(&user.ID, &user.Username, &user.Role, &createdAt); err != nil {
		return nil, err
	}

	if createdAt.Valid {
		user.CreatedAt = createdAt.Time.UTC().Format(time.RFC3339)
	}

	return &user, nil
}

func getAgents() ([]Agent, error) {
	if DB == nil {
		return nil, errors.New("database not connected")
	}

	rows, err := DB.Query(`SELECT uuid, name, hostname, ip, status, last_seen, profile, user, sleep, process, pid, arch FROM agents ORDER BY first_seen ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	agents := make([]Agent, 0)
	for rows.Next() {
		var id, name, hostname, ip, status, profile, user sql.NullString
		var sleep sql.NullInt64
		var lastSeen sql.NullTime
		var process, pidStr, arch sql.NullString
		if scanErr := rows.Scan(&id, &name, &hostname, &ip, &status, &lastSeen, &profile, &user, &sleep, &process, &pidStr, &arch); scanErr != nil {
			return nil, scanErr
		}

		noteStore.RLock()
		note := noteStore.data[id.String]
		noteStore.RUnlock()

		lastSeenISO := ""
		if lastSeen.Valid {
			lastSeenISO = lastSeen.Time.UTC().Format(time.RFC3339)
		}

		pidInt := 0
		if pidStr.Valid {
			if v, err := strconv.Atoi(pidStr.String); err == nil {
				pidInt = v
			}
		}

		agents = append(agents, Agent{
			ID:              id.String,
			Name:            name.String,
			Hostname:        hostname.String,
			IP:              ip.String,
			Status:          strings.ToUpper(status.String),
			LastSeen:        lastSeenISO,
			Notes:           note,
			OperatingSystem: "",
			Profile:         profile.String,
			User:            user.String,
			Sleep:           int(sleep.Int64),
			Process:         process.String,
			PID:             pidInt,
			Arch:            arch.String,
		})
	}

	return agents, nil
}

func renameAgent(uuid string, newName string) error {
	if DB == nil {
		return errors.New("database not connected")
	}
	if strings.TrimSpace(newName) == "" {
		return errors.New("name must not be empty")
	}
	_, err := DB.Exec("UPDATE agents SET name = ? WHERE uuid = ?", strings.TrimSpace(newName), uuid)
	return err
}

func setAgentNotes(uuid string, notes string) {
	noteStore.Lock()
	noteStore.data[uuid] = notes
	noteStore.Unlock()
}

func deleteAgent(uuid string, force bool) error {
	if DB == nil {
		return errors.New("database not connected")
	}

	var status string
	err := DB.QueryRow("SELECT status FROM agents WHERE uuid = ?", uuid).Scan(&status)
	if err != nil {
		return err
	}

	if strings.EqualFold(status, "ALIVE") {
		if !force {
			return errors.New("agent is alive; force is required")
		}
		if _, err := sendCommand(uuid, "exit"); err != nil {
			return err
		}
		_, err = DB.Exec("UPDATE agents SET status = 'DEAD' WHERE uuid = ?", uuid)
		return err
	}

	if R != nil {
		R.Del(Ctx, uuid)
	}

	_, err = DB.Exec("DELETE FROM agents WHERE uuid = ?", uuid)
	return err
}

func getAgentHistory(uuid string, limit int64) ([]string, error) {
	if R == nil {
		return nil, errors.New("redis not connected")
	}
	if limit <= 0 {
		limit = 100
	}

	historyKey := uuid + "-history"
	raw, err := R.LRange(Ctx, historyKey, -limit, -1).Result()
	if err != nil {
		return nil, err
	}

	history := make([]string, 0, len(raw))
	for _, item := range raw {
		if item == "SEEN" || item == "AGENT REGISTERED" {
			continue
		}
		history = append(history, item)
	}

	return history, nil
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

var nullOutput = []string{"exit"}

func expectsOutput(cmd string) bool {
	for _, n := range nullOutput {
		if cmd == n {
			return false
		}
	}
	return true
}

func sendCommand(uuid string, command string) (string, error) {
	parts := strings.SplitN(command, " ", 2)
	rawCmd := parts[0]
	needOutput := expectsOutput(rawCmd)

	resultChan := make(chan string, 1)
	var pubsubOutput string

	if needOutput && R != nil {
		channelName := uuid + "-output"
		pubsub := R.Subscribe(Ctx, channelName)

		defer pubsub.Close()

		if _, err := pubsub.Receive(Ctx); err != nil {
			return "", fmt.Errorf("failed to subscribe to redis channel: %w", err)
		}

		redisCh := pubsub.Channel()

		// Start a goroutine to listen for the single response
		go func() {
			msg := <-redisCh
			if msg != nil {
				resultChan <- msg.Payload // Send the payload back to the main thread
			} else {
				resultChan <- "" // Return empty if channel closes prematurely
			}
		}()
	}

	coreHost := os.Getenv("YGG_CORE")
	if coreHost == "" {
		coreHost = "yggdrasil_core"
	}
	corePort := os.Getenv("YGG_CORE_PORT")
	if corePort == "" {
		corePort = "8000"
	}
	endpoint := os.Getenv("ENDPOINT")
	if endpoint == "" {
		endpoint = "/admin"
	}
	if !strings.HasPrefix(endpoint, "/") {
		endpoint = "/" + endpoint
	}

	url := fmt.Sprintf("https://%s:%s%s", coreHost, corePort, endpoint)

	data := map[string]interface{}{
		"uuid":    uuid,
		"command": command,
	}

	jsonData, err := json.Marshal(data)
	if err != nil {
		return "", fmt.Errorf("failed to marshal json: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36")
	req.Header.Set("Sec-Purpose", "operator")

	resp, err := deployClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send post request: %w", err)
	}
	defer resp.Body.Close()

	if needOutput && R != nil {
		pubsubOutput = <-resultChan
	}

	return pubsubOutput, nil
}

func coreBaseURL() string {
	coreHost := os.Getenv("YGG_CORE")
	if coreHost == "" {
		coreHost = "yggdrasil_core"
	}
	corePort := os.Getenv("YGG_CORE_PORT")
	if corePort == "" {
		corePort = "8000"
	}
	return fmt.Sprintf("https://%s:%s", coreHost, corePort)
}

func getListenerTemplates() ([]ListenerTemplate, error) {
	url := coreBaseURL() + "/api/listeners/available"
	resp, err := httpClient.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("core returned status %d", resp.StatusCode)
	}
	var items []ListenerTemplate
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, err
	}
	return items, nil
}

func getActiveListeners() ([]ActiveListener, error) {
	url := coreBaseURL() + "/api/listeners/active"
	resp, err := httpClient.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("core returned status %d", resp.StatusCode)
	}
	var items []ActiveListener
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, err
	}
	return items, nil
}

func deployListener(name string, template string, protocol string, port int) (*ActiveListener, error) {
	url := coreBaseURL() + "/api/listeners/deploy"
	payload := map[string]interface{}{
		"name":     name,
		"template": template,
		"protocol": protocol,
		"port":     port,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewBuffer(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var body struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&body)
		if body.Error != "" {
			return nil, errors.New(body.Error)
		}
		return nil, fmt.Errorf("core returned status %d", resp.StatusCode)
	}
	var item ActiveListener
	if err := json.NewDecoder(resp.Body).Decode(&item); err != nil {
		return nil, err
	}
	return &item, nil
}

func deleteListener(id string) error {
	if strings.TrimSpace(id) == "" {
		return errors.New("listener id is required")
	}
	url := coreBaseURL() + "/api/listeners/" + id
	req, err := http.NewRequest(http.MethodDelete, url, nil)
	if err != nil {
		return err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var body struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&body)
		if body.Error != "" {
			return errors.New(body.Error)
		}
		return fmt.Errorf("core returned status %d", resp.StatusCode)
	}
	return nil
}

func addCommandLog(logEntry CommandLog) {
	commandLogStore.Lock()
	commandLogStore.data = append([]CommandLog{logEntry}, commandLogStore.data...)
	if len(commandLogStore.data) > 2000 {
		commandLogStore.data = commandLogStore.data[:2000]
	}
	commandLogStore.Unlock()
}

func getCommandLogs() []CommandLog {
	commandLogStore.RLock()
	defer commandLogStore.RUnlock()
	out := make([]CommandLog, len(commandLogStore.data))
	copy(out, commandLogStore.data)
	return out
}

func buildPublicFileURL(baseURL string, path string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if trimmed == "" {
		return path
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return trimmed + path
}

func addPublicFile(name string, path string, sizeBytes int64, baseURL string) (*PublicFile, error) {
	if DB == nil {
		return nil, errors.New("database not connected")
	}
	if strings.TrimSpace(name) == "" || strings.TrimSpace(path) == "" || strings.TrimSpace(baseURL) == "" {
		return nil, errors.New("name, path, and baseUrl are required")
	}
	res, err := DB.Exec("INSERT INTO public_files (name, file_path, size_bytes, base_url) VALUES (?, ?, ?, ?)", name, path, sizeBytes, baseURL)
	if err != nil {
		return nil, err
	}
	insertedID, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}

	return &PublicFile{
		ID:        int(insertedID),
		Name:      name,
		Path:      path,
		SizeBytes: sizeBytes,
		BaseURL:   baseURL,
		URL:       buildPublicFileURL(baseURL, path),
	}, nil
}

func listPublicFiles() ([]PublicFile, error) {
	if DB == nil {
		return nil, errors.New("database not connected")
	}
	rows, err := DB.Query("SELECT id, name, file_path, size_bytes, base_url, created_at FROM public_files ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	files := make([]PublicFile, 0)
	for rows.Next() {
		var item PublicFile
		var createdAt sql.NullTime
		if err := rows.Scan(&item.ID, &item.Name, &item.Path, &item.SizeBytes, &item.BaseURL, &createdAt); err != nil {
			return nil, err
		}
		if createdAt.Valid {
			item.CreatedAt = createdAt.Time.UTC().Format(time.RFC3339)
		}
		item.URL = buildPublicFileURL(item.BaseURL, item.Path)
		files = append(files, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return files, nil
}

func deletePublicFile(id int) error {
	if DB == nil {
		return errors.New("database not connected")
	}
	if id <= 0 {
		return errors.New("invalid file id")
	}
	var filePath string
	if err := DB.QueryRow("SELECT file_path FROM public_files WHERE id = ?", id).Scan(&filePath); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("file not found")
		}
		return err
	}
	if err := deleteHostedFile(filePath); err != nil {
		return err
	}
	_, err := DB.Exec("DELETE FROM public_files WHERE id = ?", id)
	return err
}

func deleteHostedFile(path string) error {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return errors.New("file path is required")
	}
	cleanName := filepath.Base(trimmed)
	decoded, err := url.PathUnescape(cleanName)
	if err == nil && decoded != "" {
		cleanName = decoded
	}
	coreHost := os.Getenv("YGG_CORE")
	if coreHost == "" {
		coreHost = "yggdrasil_core"
	}
	corePort := os.Getenv("YGG_CORE_PORT")
	if corePort == "" {
		corePort = "8000"
	}

	url := fmt.Sprintf("https://%s:%s/files/%s", coreHost, corePort, cleanName)
	req, err := http.NewRequest(http.MethodDelete, url, nil)
	if err != nil {
		return fmt.Errorf("failed to create delete request: %w", err)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("delete failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("delete failed with status %d", resp.StatusCode)
	}

	return nil
}

func uploadHostedFile(filename string, contentType string, body io.Reader) error {
	if strings.TrimSpace(filename) == "" {
		return errors.New("filename is required")
	}
	clean := filepath.Base(filename)
	coreHost := os.Getenv("YGG_CORE")
	if coreHost == "" {
		coreHost = "yggdrasil_core"
	}
	corePort := os.Getenv("YGG_CORE_PORT")
	if corePort == "" {
		corePort = "8000"
	}

	url := fmt.Sprintf("https://%s:%s/files/%s", coreHost, corePort, clean)
	req, err := http.NewRequest(http.MethodPut, url, body)
	if err != nil {
		return fmt.Errorf("failed to create upload request: %w", err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("upload failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("upload failed with status %d", resp.StatusCode)
	}

	return nil
}

func getAgentProfiles() (json.RawMessage, error) {
	url := coreBaseURL() + "/api/agent-profiles"
	resp, err := httpClient.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return nil, readErr
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var parsed struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &parsed)
		if parsed.Error != "" {
			return nil, errors.New(parsed.Error)
		}
		return nil, fmt.Errorf("core returned status %d", resp.StatusCode)
	}

	return json.RawMessage(body), nil
}

func buildAgent(conf CompileConfig) (json.RawMessage, int, error) {
	data, err := json.Marshal(conf)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}

	req, err := http.NewRequest(http.MethodPost, coreBaseURL()+"/api/build-agent", bytes.NewBuffer(data))
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := deployClient.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, err
	}
	defer resp.Body.Close()

	body, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return nil, http.StatusBadGateway, readErr
	}

	return json.RawMessage(body), resp.StatusCode, nil
}