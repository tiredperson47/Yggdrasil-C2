#!/bin/bash

cat << 'EOF' > Handlers/.env
DB_USER=yggdrasil
DB_PASS=PASSWORD
DATABASE=yggdrasil
HOST=localhost
DOCKER_DB=True      # Is MariaDB on same docker network or no? (Default is True)
EOF

cat << 'EOF' > tables.sql
CREATE TABLE IF NOT EXISTS agents (
    uuid VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(10),
    first_seen TIMESTAMP,
    last_seen TIMESTAMP,
    sleep INT,
    profile VARCHAR(100),
    ip VARCHAR(64)
);

GRANT ALL PRIVILEGES ON yggdrasil.* TO 'yggdrasil'@'%' IDENTIFIED BY 'NEW_PASSWORD';
FLUSH PRIVILEGES;
EOF

# liburing-dev is for Midgard C2 Agent
PASSDB=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 28)
sed -i "s/\(DB_PASS=\).*/\1${PASSDB}/" Handlers/.env
sed -i "s/IDENTIFIED BY '[^']*'/IDENTIFIED BY '$PASSDB'/" tables.sql

/usr/bin/sudo /usr/bin/apt install rlwrap liburing-dev mariadb-client-core -y


cd Handlers/Yggdrasil_Core
/usr/bin/sudo /usr/bin/docker-compose up -d --build
cd ../
/usr/bin/sudo /usr/bin/docker cp .env yggdrasil-handler:/
cd ..


echo ""
echo "========================================="
echo '[!] Waiting for database to be healthy...'
until [ "$(sudo docker inspect -f '{{.State.Health.Status}}' mariadb)" == "healthy" ]; do
    sleep 1
done
echo '[+] Database is healthy. Importing tables...'

sleep 10    # This is to make sure that mariadb database is fully set up before adding tables
/usr/bin/sudo /usr/bin/docker exec -i mariadb mariadb -h localhost -u root -p"$PASSDB" yggdrasil < tables.sql