package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

func main() {
	route := gin.Default()

	// Structs for data processing
	type RegisterRequest struct {
		B64UUID string `json:"uuid" binding:"required"`
		B64User string `json:"user"`
		B64CID  string `json:"data"`
	}

	type CommandRequest struct {
		B64UUID string `json:"uuid" binding:"required"`
		Data    string `json:"data"`
	}

	route.POST("/register", func(c *gin.Context) {
		var data RegisterRequest
		if err := c.BindJSON(&data); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		byteuser, err := base64.StdEncoding.DecodeString(data.B64User) //decode base64 string
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"Error": "Bad Data"})
			return
		}
		byteuuid, err := base64.StdEncoding.DecodeString(data.B64UUID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"Error": "Bad Data"})
			return
		}
		bytecompile_id, err := base64.StdEncoding.DecodeString(data.B64CID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"Error": "Bad Data"})
			return
		}
		user := string(byteuser)
		uuid := string(byteuuid)
		compile_id := string(bytecompile_id)
		profile := c.GetHeader("Sec-Purpose")
		hostname := c.GetHeader("X-Forwarded-Host")
		ip := c.GetHeader("X-Real-IP")

		CoreData := map[string]string{
			"user":       user,
			"uuid":       uuid,
			"compile_id": compile_id,
			"profile":    profile,
			"hostname":   hostname,
			"ip":         ip,
		}

		jsonData, err := json.Marshal(CoreData)
		if err != nil {
			c.JSON(500, gin.H{"error": "json marshal failed"})
			return
		}

		req, err := http.NewRequest("POST", "http://Yggdrasil_Core:8000/register", bytes.NewBuffer(jsonData))
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to create request"})
			return
		}
		req.Header.Set("Content-Type", "application/json")

		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			c.JSON(500, gin.H{"error": "forwarding to core failed"})
			return
		}
		defer resp.Body.Close()

		// read ygg core response
		respBody, _ := io.ReadAll(resp.Body)

		// return response to agent
		c.Data(resp.StatusCode, "application/json", respBody)
	})

	route.Match([]string{"GET", "POST"}, "/callback", func(c *gin.Context) {
		if c.Request.Method == "GET" {
			b64uuid := c.Query("uuid")
			byteuuid, err := base64.StdEncoding.DecodeString(b64uuid)
			if err != nil {
				log.Println(err)
				return
			}
			uuid := string(byteuuid)

			CoreData := map[string]string{
				"uuid":   uuid,
				"action": "Request",
			}

			jsonData, err := json.Marshal(CoreData)
			if err != nil {
				c.JSON(500, gin.H{"error": "json marshal failed"})
				return
			}

			req, err := http.NewRequest("POST", "http://Yggdrasil_Core:8000/callback", bytes.NewBuffer(jsonData))
			if err != nil {
				c.JSON(500, gin.H{"error": "failed to create request"})
				return
			}
			req.Header.Set("Content-Type", "application/json")

			client := &http.Client{}
			resp, err := client.Do(req)
			if err != nil {
				c.JSON(500, gin.H{"error": "forwarding to core failed"})
				return
			}
			defer resp.Body.Close()

			// read ygg core response
			respBody, _ := io.ReadAll(resp.Body)

			// return response to agent
			c.Data(resp.StatusCode, "application/json", respBody)

		} else if c.Request.Method == "POST" {
			var data CommandRequest
			if err := c.BindJSON(&data); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"Error": "Bad JSON"})
				return
			}
			byteuuid, err := base64.StdEncoding.DecodeString(data.B64UUID)
			if err != nil {
				log.Println(err)
				return
			}
			uuid := string(byteuuid)

			CoreData := map[string]string{
				"uuid":   uuid,
				"data":   data.Data,
				"action": "Reply",
			}

			jsonData, err := json.Marshal(CoreData)
			if err != nil {
				c.JSON(500, gin.H{"error": "json marshal failed"})
				return
			}

			req, err := http.NewRequest("POST", "http://Yggdrasil_Core:8000/callback", bytes.NewBuffer(jsonData))
			if err != nil {
				c.JSON(500, gin.H{"error": "failed to create request"})
				return
			}
			req.Header.Set("Content-Type", "application/json")

			client := &http.Client{}
			resp, err := client.Do(req)
			if err != nil {
				c.JSON(500, gin.H{"error": "forwarding to core failed"})
				return
			}
			defer resp.Body.Close()

			// read ygg core response
			respBody, _ := io.ReadAll(resp.Body)

			// return response to agent
			c.Data(resp.StatusCode, "application/json", respBody)

		} else {
			c.JSON(http.StatusBadRequest, gin.H{"Error": "Invalid Method"})
			return
		}
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "80" // default
	}
	route.Run(":" + port)
}
