package main

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

var sessionStore = struct {
	sync.RWMutex
	data map[string]User
}{
	data: make(map[string]User),
}

func newSessionToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func setSessionCookie(c *gin.Context, token string) {
	cookie := &http.Cookie{
		Name:     "ygg_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   60 * 60 * 24,
	}
	http.SetCookie(c.Writer, cookie)
}

func clearSessionCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "ygg_session",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
	})
}

func authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := c.Cookie("ygg_session")
		if err != nil || token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			c.Abort()
			return
		}
		sessionStore.RLock()
		user, ok := sessionStore.data[token]
		sessionStore.RUnlock()
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			c.Abort()
			return
		}
		c.Set("sessionUser", user)
		c.Next()
	}
}

func main() {
	r := gin.Default()
	r.Use(corsMiddleware())

	api := r.Group("/api")
	{
		api.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"ok": true})
		})

		// Authentication endpoints
		api.POST("/auth/login", func(c *gin.Context) {
			var req struct {
				Username string `json:"username"`
				Password string `json:"password"`
			}
			if err := c.BindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
				return
			}

			user, err := verifyUser(req.Username, req.Password)
			if err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
				return
			}

			token, err := newSessionToken()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "session error"})
				return
			}
			sessionStore.Lock()
			sessionStore.data[token] = *user
			sessionStore.Unlock()
			setSessionCookie(c, token)

			c.JSON(http.StatusOK, user)
		})

		api.POST("/auth/logout", func(c *gin.Context) {
			token, _ := c.Cookie("ygg_session")
			if token != "" {
				sessionStore.Lock()
				delete(sessionStore.data, token)
				sessionStore.Unlock()
			}
			clearSessionCookie(c)
			c.JSON(http.StatusOK, gin.H{"ok": true})
		})

		api.GET("/auth/me", func(c *gin.Context) {
			token, err := c.Cookie("ygg_session")
			if err != nil || token == "" {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
				return
			}
			sessionStore.RLock()
			user, ok := sessionStore.data[token]
			sessionStore.RUnlock()
			if !ok {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
				return
			}
			c.JSON(http.StatusOK, user)
		})

		protected := api.Group("")
		protected.Use(authMiddleware())

		protected.POST("/auth/register", func(c *gin.Context) {
			var req struct {
				Username string `json:"username"`
				Password string `json:"password"`
				Role     string `json:"role"`
			}
			if err := c.BindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
				return
			}

			if err := createUser(req.Username, req.Password, req.Role); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}

			c.JSON(http.StatusCreated, gin.H{"ok": true})
		})

		protected.GET("/auth/users", func(c *gin.Context) {
			users, err := getAllUsers()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, users)
		})

		protected.DELETE("/auth/users/:id", func(c *gin.Context) {
			userID := c.Param("id")
			parsedID, err := strconv.Atoi(userID)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
				return
			}

			if err := deleteUser(parsedID); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}

			c.JSON(http.StatusOK, gin.H{"ok": true})
		})

		protected.POST("/auth/change-password", func(c *gin.Context) {
			var req struct {
				RequesterID   int    `json:"requesterId"`
				RequesterRole string `json:"requesterRole"`
				TargetUserID  int    `json:"targetUserId"`
				NewPassword   string `json:"newPassword"`
			}
			if err := c.BindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
				return
			}

			if req.RequesterID <= 0 || req.TargetUserID <= 0 || strings.TrimSpace(req.RequesterRole) == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "requesterId, requesterRole, and targetUserId are required"})
				return
			}

			if !strings.EqualFold(req.RequesterRole, "admin") && req.RequesterID != req.TargetUserID {
				c.JSON(http.StatusForbidden, gin.H{"error": "operators can only change their own password"})
				return
			}

			if err := changePassword(req.TargetUserID, req.NewPassword); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}

			c.JSON(http.StatusOK, gin.H{"ok": true})
		})

		protected.GET("/agents", func(c *gin.Context) {
			agents, err := getAgents()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, agents)
		})

		protected.PATCH("/agents/:id/rename", func(c *gin.Context) {
			var req struct {
				Name string `json:"name"`
			}
			if err := c.BindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
				return
			}
			if err := renameAgent(c.Param("id"), req.Name); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"ok": true})
		})

		protected.PATCH("/agents/:id/notes", func(c *gin.Context) {
			var req struct {
				Notes string `json:"notes"`
			}
			if err := c.BindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
				return
			}
			setAgentNotes(c.Param("id"), req.Notes)
			c.JSON(http.StatusOK, gin.H{"ok": true})
		})

		protected.DELETE("/agents/:id", func(c *gin.Context) {
			force := strings.EqualFold(c.Query("force"), "true")
			err := deleteAgent(c.Param("id"), force)
			if err != nil {
				if strings.Contains(err.Error(), "force is required") {
					c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "requiresForce": true})
					return
				}
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"ok": true})
		})

		protected.GET("/agents/:id/history", func(c *gin.Context) {
			limit := int64(100)
			if raw := c.Query("limit"); raw != "" {
				if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
					limit = parsed
				}
			}
			history, err := getAgentHistory(c.Param("id"), limit)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"history": history})
		})

		protected.POST("/commands/send", func(c *gin.Context) {
			var req struct {
				UserID   string `json:"userId"`
				Username string `json:"username"`
				AgentID  string `json:"agentId"`
				Command  string `json:"command"`
			}
			if err := c.BindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
				return
			}
			if strings.TrimSpace(req.AgentID) == "" || strings.TrimSpace(req.Command) == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "agentId and command are required"})
				return
			}

			output, err := sendCommand(req.AgentID, req.Command)
			if err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
				return
			}

			entry := CommandLog{
				ID:        strconv.FormatInt(time.Now().UnixNano(), 10),
				UserID:    req.UserID,
				Username:  req.Username,
				AgentID:   req.AgentID,
				Command:   req.Command,
				Timestamp: time.Now().UTC().Format(time.RFC3339),
			}
			addCommandLog(entry)
			c.JSON(http.StatusOK, gin.H{
				"log":    entry,
				"output": output,
			})
		})

		protected.GET("/command-logs", func(c *gin.Context) {
			c.JSON(http.StatusOK, getCommandLogs())
		})

		protected.GET("/listeners/templates", func(c *gin.Context) {
			items, err := getListenerTemplates()
			if err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, items)
		})

		protected.GET("/listeners/active", func(c *gin.Context) {
			items, err := getActiveListeners()
			if err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, items)
		})

		protected.POST("/listeners/deploy", func(c *gin.Context) {
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
				c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, listener)
		})

		protected.DELETE("/listeners/:id", func(c *gin.Context) {
			listenerID := strings.TrimSpace(c.Param("id"))
			if listenerID == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "listener id is required"})
				return
			}
			if err := deleteListener(listenerID); err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"ok": true})
		})

		protected.GET("/agents/stream", func(c *gin.Context) {
			if R == nil {
				c.JSON(http.StatusServiceUnavailable, gin.H{"error": "redis not connected"})
				return
			}
			c.Writer.Header().Set("Content-Type", "text/event-stream")
			c.Writer.Header().Set("Cache-Control", "no-cache")
			c.Writer.Header().Set("Connection", "keep-alive")
			c.Writer.Flush()

			pubsub := R.Subscribe(Ctx, "agent_update", "new_agent")
			defer pubsub.Close()

			ch := pubsub.Channel()
			for {
				select {
				case <-c.Request.Context().Done():
					return
				case msg := <-ch:
					if msg == nil {
						continue
					}
					fmt.Fprintf(c.Writer, "data: %s\n\n", msg.Payload)
					c.Writer.Flush()
				}
			}
		})

		protected.POST("/files/upload", func(c *gin.Context) {
			file, err := c.FormFile("file")
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
				return
			}
			hostAs := strings.TrimSpace(c.PostForm("name"))
			if hostAs == "" {
				hostAs = file.Filename
			}
			baseURL := strings.TrimSpace(c.PostForm("baseUrl"))
			if baseURL == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "baseUrl is required"})
				return
			}

			opened, err := file.Open()
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "failed to open file"})
				return
			}
			defer opened.Close()

			contentType := file.Header.Get("Content-Type")
			if err := uploadHostedFile(hostAs, contentType, opened); err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
				return
			}

			cleanName := strings.TrimSpace(hostAs)
			pathPart := "/static/templates/public/files/" + url.PathEscape(cleanName)
			record, err := addPublicFile(cleanName, pathPart, file.Size, baseURL)
			if err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"ok": true, "file": record})
		})

		protected.GET("/files/public", func(c *gin.Context) {
			files, err := listPublicFiles()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, files)
		})

		protected.DELETE("/files/public/:id", func(c *gin.Context) {
			parsedID, err := strconv.Atoi(c.Param("id"))
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file id"})
				return
			}
			if err := deletePublicFile(parsedID); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"ok": true})
		})

		protected.GET("/agent-profiles", func(c *gin.Context) {
			profiles, err := getAgentProfiles()
			if err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
				return
			}
			c.Data(http.StatusOK, "application/json", profiles)
		})

		protected.POST("/build-agent", func(c *gin.Context) {
			var req CompileConfig
			if err := c.BindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
				return
			}

			body, status, err := buildAgent(req)
			if err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
				return
			}

			c.Data(status, "application/json", body)
		})
	}

	// Serve static assets (JS, CSS, etc.)
	r.Static("/assets", "./dist/assets")
	r.StaticFile("/favicon.ico", "./dist/favicon.ico")
	r.StaticFile("/vite.svg", "./dist/vite.svg")

	// Serve index.html for SPA routing
	r.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "endpoint not found"})
			return
		}
		c.File("./dist/index.html")
	})

	if err := r.RunTLS(":8080", "/app/certs/server.crt", "/app/certs/server.key"); err != nil && !errors.Is(err, http.ErrServerClosed) {
		panic(err)
	}
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		c.Writer.Header().Set("Vary", "Origin")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
