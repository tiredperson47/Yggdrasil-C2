package main

import (
	"bytes"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

func handleError(c *gin.Context, err error) bool {
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"Error": "Bad Data"})
		return true
	}
	return false
}

func main() {
	route := gin.Default()

	// Structs for data processing
	type RegisterRequest struct {
		B64User     string `json:"user"`
		B64CID      string `json:"data" binding:"required"`
		B64Profile  string `json:"profile"`
		B64Hostname string `json:"hostname"`
		B64Process  string `json:"process"`
		B64PID      string `json:"pid"`
		B64Arch     string `json:"arch"`
	}

	type CommandRequest struct {
		B64UUID string `json:"uuid" binding:"required"`
		Data    string `json:"data"`
	}

	route.POST("/register", func(c *gin.Context) {
		raw, _ := io.ReadAll(c.Request.Body)
		log.Printf("register headers: %#v", c.Request.Header)
		log.Printf("register raw body: %q", string(raw))
		c.Request.Body = io.NopCloser(bytes.NewBuffer(raw))

		var data RegisterRequest
		if err := c.ShouldBindJSON(&data); err != nil {
			log.Printf("register bind error: %v", err)
			c.JSON(http.StatusBadRequest, gin.H{
				"error": err.Error(),
				"body":  string(raw),
			})
			return
		}
		byteuser, err := base64.StdEncoding.DecodeString(data.B64User) //decode base64 string
		if handleError(c, err) {
			return
		}
		bytecompile_id, err := base64.StdEncoding.DecodeString(data.B64CID)
		if handleError(c, err) {
			return
		}
		byteprofile, err := base64.StdEncoding.DecodeString(data.B64Profile)
		if handleError(c, err) {
			return
		}
		bytehostname, err := base64.StdEncoding.DecodeString(data.B64Hostname)
		if handleError(c, err) {
			return
		}
		byteprocess, err := base64.StdEncoding.DecodeString(data.B64Process)
		if handleError(c, err) {
			return
		}
		bytepid, err := base64.StdEncoding.DecodeString(data.B64PID)
		if handleError(c, err) {
			return
		}
		bytearch, err := base64.StdEncoding.DecodeString(data.B64Arch)
		if handleError(c, err) {
			return
		}
		
		user := string(byteuser)
		compile_id := string(bytecompile_id)
		profile := string(byteprofile)
		hostname := string(bytehostname)
		process := string(byteprocess)
		pid := string(bytepid)
		arch := string(bytearch)
		ip := c.GetHeader("X-Real-IP")

		CoreData := map[string]string{
			"user":       user,
			"compile_id": compile_id,
			"profile":    profile,
			"hostname":   hostname,
			"process":    process,
			"pid":        pid,
			"arch":       arch,
			"ip":         ip,
		}

		jsonData, err := json.Marshal(CoreData)
		if err != nil {
			c.JSON(500, gin.H{"error": "json marshal failed"})
			return
		}

		req, err := http.NewRequest("POST", "https://Yggdrasil_Core:8000/register", bytes.NewBuffer(jsonData))
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to create request"})
			return
		}
		req.Header.Set("Content-Type", "application/json")

		client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
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
			b64uuid := c.Query("id")
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

			req, err := http.NewRequest("POST", "https://Yggdrasil_Core:8000/callback", bytes.NewBuffer(jsonData))
			if err != nil {
				c.JSON(500, gin.H{"error": "failed to create request"})
				return
			}
			req.Header.Set("Content-Type", "application/json")

			client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
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

			req, err := http.NewRequest("POST", "https://Yggdrasil_Core:8000/callback", bytes.NewBuffer(jsonData))
			if err != nil {
				c.JSON(500, gin.H{"error": "failed to create request"})
				return
			}
			req.Header.Set("Content-Type", "application/json")

			client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
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
