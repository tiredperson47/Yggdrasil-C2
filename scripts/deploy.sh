#!/bin/bash

read -p "Server Public IP: " HOST

/usr/bin/cat << 'EOF' > ../Handlers/.env
DB_USER=yggdrasil
DB_PASS=PASSWORD
DATABASE=yggdrasil
HOST=localhost
DOCKER_DB=True          # Is MariaDB on same docker network or no? (Default is True)
REDIS_HOST=127.0.0.1
YGG_CORE=127.0.0.1      # Yggdrasil_Core or Nginx reverse proxy IP/Domain
YGG_CORE_PORT=8000      # Yggdrasil_Core or Nginx reverse proxy Port
EOF

/usr/bin/cat << 'EOF' > ./tables.sql
CREATE TABLE IF NOT EXISTS agents (
    uuid VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(10),
    first_seen TIMESTAMP,
    last_seen TIMESTAMP,
    sleep INT,
    profile VARCHAR(100),
    ip VARCHAR(64),
    hostname VARCHAR(255)
);

GRANT ALL PRIVILEGES ON yggdrasil.* TO 'yggdrasil'@'%' IDENTIFIED BY 'NEW_PASSWORD';
FLUSH PRIVILEGES;
EOF

# liburing-dev is for Midgard C2 Agent
# Generate random DB password.
PASSDB=$(/usr/bin/tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)
/usr/bin/sed -i "s/\(DB_PASS=\).*/\1${PASSDB}/" ../Handlers/.env
/usr/bin/sed -i "s/IDENTIFIED BY '[^']*'/IDENTIFIED BY '$PASSDB'/" tables.sql

/usr/bin/sudo /usr/bin/apt install rlwrap mariadb-client-core upx -y
read -p "Do you want to install dependencies for the Midgard Agent? (y\n) " choice

if [[ $choice == y || $choice == Y ]]; then
    /usr/bin/sudo /usr/bin/apt install liburing-dev libmbedtls-dev -y
fi

/usr/bin/mkdir -p ../Handlers/Yggdrasil_Core/certs
cd ../Handlers/Yggdrasil_Core/certs
/usr/bin/openssl req -x509 -newkey rsa:4096 -nodes -out cert.pem -keyout key.pem -days 365 -subj "/C=US/ST=CA/O=./CN=$HOST"
cd ../../
/usr/bin/sudo /usr/bin/docker-compose up -d --build
/usr/bin/sudo /usr/bin/docker cp .env Yggdrasil_Core:/app
cd ..
/usr/bin/python3 scripts/string.py Handlers/Yggdrasil_Core/certs/cert.pem > Agent_Profiles/Midgard/agent_functions/functions/connection/cert.h
/usr/bin/sed -i "s/127\.0\.0\.1/$HOST/g" Agent_Profiles/Midgard/agent_functions/functions/connection/connection.c

echo ""
echo "========================================="
echo '[!] Waiting for database to be healthy...'
until [ "$(/usr/bin/sudo /usr/bin/docker inspect -f '{{.State.Health.Status}}' mariadb)" == "healthy" ]; do
    /usr/bin/sleep 1
done
echo '[+] Database is healthy. Importing tables...'

/usr/bin/sleep 10    # This is to make sure that mariadb database is fully set up before adding tables
/usr/bin/sudo /usr/bin/docker exec -i mariadb mariadb -h localhost -u root -p"$PASSDB" yggdrasil < scripts/tables.sql
echo '[+] Done!'