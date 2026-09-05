FROM node:20-alpine AS webbuild
WORKDIR /src

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM golang:1.24-alpine AS gobuild
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY main.go functions.go ./
COPY --from=webbuild /src/dist ./dist

RUN go build -o /frontend-app .

FROM alpine:3.21
WORKDIR /app

COPY --from=gobuild /frontend-app /app/frontend-app
COPY --from=gobuild /src/dist /app/dist

EXPOSE 8080
CMD ["/app/frontend-app"]
