#!/bin/bash

read -p "Server Public IP: " HOST

# Create necessary files
/usr/bin/cat << EOF > ../Handlers/.env
DB_USER=yggdrasil
DB_PASS=PASSWORD
DATABASE=yggdrasil
DB_HOST=localhost
DOCKER_DB=True                      # Is MariaDB on same docker network or no? (Default is True)
REDIS_HOST=127.0.0.1                # Same IP as Nginx reverse proxy if being used
REDIS_PASS=PASSWORD
YGG_CORE=127.0.0.1                  # Yggdrasil_Core or Nginx reverse proxy IP/Domain
YGG_CORE_PORT=8000                  # Yggdrasil_Core or Nginx reverse proxy Port
ENDPOINT=/v3/api/admin              # Endpoint for yggdrasil_core admin
EOF

/usr/bin/cat << EOF > ./tables.sql
CREATE TABLE IF NOT EXISTS agents (
    uuid VARCHAR(50) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    status VARCHAR(10),
    first_seen TIMESTAMP,
    last_seen TIMESTAMP,
    sleep INT,
    profile VARCHAR(50),
    ip VARCHAR(45),
    hostname VARCHAR(100),
    user VARCHAR(100),
    compile_id VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS payloads (
    compile_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    profile VARCHAR(100) NOT NULL,
    created TIMESTAMP,
    use_aes BOOLEAN NOT NULL DEFAULT TRUE,
    private VARCHAR(1024),
    public VARCHAR(1024)
);

GRANT ALL PRIVILEGES ON yggdrasil.* TO 'yggdrasil'@'%' IDENTIFIED BY 'NEW_PASSWORD' REQUIRE SSL;
FLUSH PRIVILEGES;
EOF

/usr/bin/mkdir -p ../Handlers/nginx/certs
/usr/bin/mkdir -p ../Handlers/mariadb/certs
/usr/bin/mkdir -p ../Handlers/Yggdrasil_Core/certs
/usr/bin/cat << EOF > ../Handlers/nginx/certs/openssl.cnf
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
IP.1 = 127.0.0.1
IP.2 = IP
EOF


# Generate random DB password.
PASSDB=$(/usr/bin/tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)
/usr/bin/sed -i "s/\(DB_PASS=\).*/\1${PASSDB}/" ../Handlers/.env
/usr/bin/sed -i "s/IDENTIFIED BY '[^']*'/IDENTIFIED BY '$PASSDB'/" tables.sql
REDIS=$(/usr/bin/tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)
/usr/bin/sed -i "s/\(REDIS_PASS=\).*/\1${REDIS}/" ../Handlers/.env



# Install dependencies
read -p "Do you want to install general dependencies (this will apt update)? (y\n) " depend
if [[ $depend == y || $depend == Y ]]; then
    /usr/bin/sudo /usr/bin/apt update -y
    /usr/bin/sudo /usr/bin/apt install rlwrap mariadb-client-core docker.io docker-compose -y
fi

read -p "Do you want to install dependencies for the Midgard Agent? (y\n) " choice
if [[ $choice == y || $choice == Y ]]; then
    /usr/bin/sudo /usr/bin/apt install liburing-dev libmbedtls-dev libcjson-dev upx -y
fi



cd ../Handlers/nginx/certs
# Generate CA certificates
/usr/bin/sed -i "s/IP\.2 = .*/IP.2 = $HOST/" openssl.cnf
/usr/bin/openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out ca.key
/usr/bin/openssl req -x509 -new -nodes -key ca.key -sha256 -days 365 -out ca.crt -subj "/CN=ca" -config openssl.cnf -extensions v3_ca

# Generate nginx certificate
/usr/bin/openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out nginx.key
/usr/bin/openssl req -new -key nginx.key -out nginx.csr -subj "/CN=Nginx" 
/usr/bin/openssl x509 -req -in nginx.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out nginx.crt -days 365 -sha256 -extfile openssl.cnf -extensions v3_nginx_server

# Create client keys
/usr/bin/openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out client.key
/usr/bin/openssl req -new -key client.key -out client.csr -subj "/C=US/ST=California/CN=Client"
/usr/bin/openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt -days 365 -sha256 -extfile openssl.cnf -extensions v3_client

/usr/bin/rm openssl.cnf *.srl *.csr
/usr/bin/cp ca.crt ../../mariadb/certs/
/usr/bin/cp nginx.crt ../../mariadb/certs/
/usr/bin/cp nginx.key ../../mariadb/certs/
/usr/bin/cp ca.crt ../../Yggdrasil_Core/certs
/usr/bin/cp client.crt ../../Yggdrasil_Core/certs
/usr/bin/cp client.key ../../Yggdrasil_Core/certs
cd ../../


# Build the infrastructure and modify public IP
/usr/bin/sudo /usr/bin/docker-compose up -d --build
cd ..
if /usr/bin/python3 scripts/cert_header.py -m Server Handlers/nginx/certs/ca.crt > Agent_Profiles/Midgard/agent_functions/functions/connection/cert.h; then
    echo ""
else
    exit 1
fi
/usr/bin/sed -i "s/127\.0\.0\.1/$HOST/g" Agent_Profiles/Midgard/agent_functions/functions/connection/connection.c
/usr/bin/sed -i "s/127\.0\.0\.1/$HOST/g" Handlers/nginx/scripts/stager
/usr/bin/sed -i "s/YGG_CORE\=127\.0\.0\.1/YGG_CORE\=$HOST/g" Handlers/.env



echo "========================================="
echo '[!] Waiting for database to be healthy...'
until [ "$(/usr/bin/sudo /usr/bin/docker inspect -f '{{.State.Health.Status}}' mariadb)" == "healthy" ]; do
    /usr/bin/sleep 1
done
echo '[+] Database is healthy. Importing tables...'

/usr/bin/sleep 10    # This is to make sure that mariadb database is fully set up before adding tables
/usr/bin/sudo /usr/bin/docker exec -i mariadb mariadb -h localhost -u root -p"$PASSDB" yggdrasil < scripts/tables.sql
echo '[+] Done!'