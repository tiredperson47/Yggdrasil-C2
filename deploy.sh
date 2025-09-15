#!/bin/bash

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

sleep 10
/usr/bin/sudo /usr/bin/docker exec -i mariadb mariadb -h localhost -u root -p"$PASSDB" yggdrasil < tables.sql