#!/bin/bash

read -p "Server Public IP/Hostname (default: 127.0.0.1): " HOST
HOST=${HOST:-"127.0.0.1"}

# Generate random DB password.
PASSDB=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)
REDIS=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)
HEALTHCHECK=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)
SALT=$(openssl rand -hex 16)
cd ..
PROJECT=${PWD}
cd ${PROJECT}/scripts

# Create necessary files
cat << EOF > ${PROJECT}/Handlers/.env
PROJECT_ROOT=${PROJECT}
DB_USER=yggdrasil
DB_PASS=${PASSDB}
DATABASE=yggdrasil
DB_HOST=localhost
DOCKER_DB=True                      # Is MariaDB on same docker network or no? (Default is True)
REDIS_HOST=${HOST}                  # Same IP as Nginx reverse proxy if being used
REDIS_PASS=${REDIS}
YGG_CORE=${HOST}                    # Yggdrasil_Core or Nginx reverse proxy IP/Domain
YGG_CORE_PORT=8000                  # Yggdrasil_Core or Nginx reverse proxy Port
LOCAL_REVERSE_PROXY=True
ENDPOINT=/v3/api/admin              # Endpoint for yggdrasil_core admin
SALT=${SALT}
HEALTHCHECK=${HEALTHCHECK}
EOF

cat << EOF > ./tables.sql
CREATE TABLE IF NOT EXISTS agents (
    uuid CHAR(36) NOT NULL PRIMARY KEY,
    name VARCHAR(255),
    status VARCHAR(32),
    first_seen DATETIME,
    last_seen DATETIME,
    sleep INT,
    profile VARCHAR(255),
    ip VARCHAR(255),
    process VARCHAR(255),
    pid INT,
    arch VARCHAR(20),
    hostname VARCHAR(150),
    user VARCHAR(255),
    compile_id CHAR(36) NOT NULL,

    INDEX idx_agents_compile_id (compile_id)
);

CREATE TABLE IF NOT EXIStS payloads (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    compile_id CHAR(36) NOT NULL UNIQUE,
    profile_id CHAR(36),
    profile VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    created DATETIME NOT NULL,
    use_aes TINYINT NOT NULL DEFAULT 0,
    arch VARCHAR(64),
    os VARCHAR(64),
    listener VARCHAR(255),
    private VARCHAR(64),
    public VARCHAR(32),

    INDEX idx_payloads_compile_id (compile_id),
    INDEX idx_payloads_profile (profile)
);

CREATE TABLE IF NOT EXISTS operators (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public_files (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    file_path VARCHAR(512) NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    base_url VARCHAR(512) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

GRANT ALL PRIVILEGES ON yggdrasil.* TO 'yggdrasil'@'%' IDENTIFIED BY '${PASSDB}' REQUIRE SSL;

DROP USER IF EXISTS 'healthcheck'@'mariadb';
DROP USER IF EXISTS 'healthcheck'@'localhost';
DROP USER IF EXISTS 'healthcheck'@'127.0.0.1';
CREATE USER 'healthcheck'@'mariadb' IDENTIFIED BY '${HEALTHCHECK}';
CREATE USER 'healthcheck'@'localhost' IDENTIFIED BY '${HEALTHCHECK}';
CREATE USER 'healthcheck'@'127.0.0.1' IDENTIFIED BY '${HEALTHCHECK}';
GRANT USAGE ON *.* TO 'healthcheck'@'mariadb';
GRANT USAGE ON *.* TO 'healthcheck'@'localhost';
GRANT USAGE ON *.* TO 'healthcheck'@'127.0.0.1';
FLUSH PRIVILEGES;
EOF

cat << EOF > ${PROJECT}/Handlers/mariadb/health.cnf
[client]
user=healthcheck
password=${HEALTHCHECK}
socket=/var/run/mysqld/mysqld.sock
host=127.0.0.1
EOF

chmod 600 ${PROJECT}/Handlers/.env ${PROJECT}/Handlers/mariadb/health.cnf tables.sql

mkdir -p ${PROJECT}/Handlers/certs
mkdir -p ${PROJECT}/Handlers/mariadb/certs
mkdir -p ${PROJECT}/Compiled_Payloads
mkdir -p ${PROJECT}/Wrappers

cat << EOF > ${PROJECT}/Handlers/certs/openssl.cnf
[ v3_ca ]
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign

[ v3_nginx_server ]
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names_nginx

[ v3_client ]
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = clientAuth

[ alt_names_nginx ]
DNS.1 = localhost
DNS.2 = mariadb
IP.1 = 127.0.0.1
IP.2 = ${HOST}
EOF



# Install dependencies
read -p "If this is a first time installation, please install dependencies. Otherwise you may skip. Install? (y\n) " depend
if [[ $depend == y || $depend == Y ]]; then
    sudo apt update -y
    sudo apt install rlwrap mariadb-client-core docker.io docker-compose golang binutils gcc-x86-64-linux-gnu gcc-aarch64-linux-gnu argon2 -y
fi

read -p "Do you want to install dependencies for the Midgard Agent? (y\n) " choice
if [[ "${choice,,}" == y ]]; then
    sudo apt install upx cmake -y
    cd ${PROJECT}/Agent_Profiles/Midgard/compiler
    git clone https://github.com/DaveGamble/cJSON.git
    cd cJSON
    mkdir build
    cd build
    cmake .. -DENABLE_CJSON_UTILS=On -DENABLE_CJSON_TEST=Off -DCMAKE_INSTALL_PREFIX=/usr -DBUILD_SHARED_LIBS=Off
    make
    sudo make install
    sudo /usr/sbin/ldconfig
    cd ${PROJECT}/scripts
fi

read -p "Will you use an nginx reverse proxy? (y\n) [default: y]: " reverse
reverse=${reverse:-"y"}
if [[ "${reverse,,}" == y ]]; then
    read -p "Will the reverse proxy be on the same server as the C2? (y\n) [default: y]: " local
    local=${local:-"y"}
    if [[ "${local,,}" == y ]]; then
        sed -i '/ports:/{N;s/ports:[ \t]*\n[ \t]*- "8081:8081"/expose:\n      - "8081"/}' ${PROJECT}/Handlers/docker-compose.yml
        echo "LOCAL_PROXY=1" >> ${PROJECT}/Handlers/.env
    else
        sed -i '/expose:/{N;s/expose:[ \t]*\n[ \t]*- "8081"/ports:\n      - "8081:8081"/}' ${PROJECT}/Handlers/docker-compose.yml
        echo "LOCAL_PROXY=0" >> ${PROJECT}/Handlers/.env
    fi
else
    sed -i '/expose:/{N;s/expose:[ \t]*\n[ \t]*- "8081"/ports:\n      - "8081:8081"/}' ${PROJECT}/Handlers/docker-compose.yml
    echo "LOCAL_PROXY=0" >> ${PROJECT}/Handlers/.env
fi

cd ${PROJECT}/Handlers/certs
# Generate CA certificates
sed -i "s/IP\.2 = .*/IP.2 = $HOST/" openssl.cnf
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out ca.key
openssl req -x509 -new -nodes -key ca.key -sha256 -days 365 -out ca.crt -subj "/CN=ca" -config openssl.cnf -extensions v3_ca

# Generate nginx certificate
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out server.key
openssl req -new -key server.key -out nginx.csr -subj "/CN=Nginx" 
openssl x509 -req -in nginx.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365 -sha256 -extfile openssl.cnf -extensions v3_nginx_server

# Create client keys
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out client.key
openssl req -new -key client.key -out client.csr -subj "/C=US/ST=California/CN=Client"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt -days 365 -sha256 -extfile openssl.cnf -extensions v3_client

rm openssl.cnf *.srl *.csr
cp server.crt server.key ca.crt ${PROJECT}/Handlers/mariadb/certs/
cd ${PROJECT}/Handlers

# Sed command to add nameserver 8.8.8.8 to /etc/resolv.conf (for go mod download)
sudo sed -i '
/^nameserver[[:space:]]\+8\.8\.8\.8$/d
0,/^nameserver/{
    /^nameserver/ i\
nameserver 8.8.8.8
}
' /etc/resolv.conf


# Build the infrastructure and modify public IP
sudo docker-compose up -d --build
cd ${PROJECT}
if python3 scripts/cert_header.py -m Server ${PROJECT}/Handlers/certs/ca.crt > ${PROJECT}/Agent_Profiles/Midgard/agent_functions/functions/connection/cert.h; then
    echo ""
else
    exit 1
fi
sed -i "s/127\.0\.0\.1/$HOST/g" ${PROJECT}/Agent_Profiles/Midgard/agent_functions/functions/connection/connection.c
sed -i "s/127\.0\.0\.1/$HOST/g" ${PROJECT}/Handlers/Yggdrasil_Core/hosted_files/stager
sed -i "s/YGG_CORE\=127\.0\.0\.1/YGG_CORE\=$HOST/g" ${PROJECT}/Handlers/.env



echo "========================================="
echo '[!] Waiting for database to be healthy...'
# Generate default admin password (16 chars: uppercase, lowercase, numbers, special chars)
ADMIN_PASSWORD=""
while [ ${#ADMIN_PASSWORD} -lt 16 ]; do
    ADMIN_PASSWORD="${ADMIN_PASSWORD}$(tr -dc 'A-Z' < /dev/urandom | head -c 1)"
    ADMIN_PASSWORD="${ADMIN_PASSWORD}$(tr -dc 'a-z' < /dev/urandom | head -c 1)"
    ADMIN_PASSWORD="${ADMIN_PASSWORD}$(tr -dc '0-9' < /dev/urandom | head -c 1)"
    ADMIN_PASSWORD="${ADMIN_PASSWORD}$(tr -dc '!@#$%^&*' < /dev/urandom | head -c 1)"
done
ADMIN_PASSWORD=$(echo -n "$ADMIN_PASSWORD" | head -c 16)
ADMIN_SALT="$SALT"
HASH=$(echo -n "$ADMIN_PASSWORD" | argon2 "$ADMIN_SALT" -id -m 14 -t 2 -p 4 -l 32 -r | tr -d '\n')

until [ "$(sudo docker inspect -f '{{.State.Health.Status}}' mariadb)" == "healthy" ]; do
    sleep 1
done
echo '[+] Database is healthy. Importing tables...'

sleep 10
sudo docker exec -e MYSQL_PWD="$PASSDB" -i mariadb mariadb -h localhost -u root -p"$PASSDB" yggdrasil < ${PROJECT}/scripts/tables.sql
echo "INSERT INTO operators (username, password, role) VALUES ('admin', '$HASH', 'admin');" | sudo docker exec -e MYSQL_PWD="$PASSDB" -i mariadb mariadb -h localhost -u root -p"$PASSDB" yggdrasil

echo '[+] Done!'

echo ""
echo "========================================="
echo "[+] DEFAULT ADMIN CREDENTIALS"
echo "========================================="
echo "Username: admin"
echo "Password: ${ADMIN_PASSWORD}"
echo "========================================="
echo ""
echo "YGGDRASIL_ADMIN_PASSWORD=${ADMIN_PASSWORD}" >> ${PROJECT}/Handlers/.env

rm ${PROJECT}/scripts/tables.sql