#!/bin/bash

/usr/bin/sudo /usr/bin/docker stop redis Yggdrasil_Core mariadb
/usr/bin/sudo /usr/bin/docker container prune
/usr/bin/sudo /usr/bin/docker builder prune
/usr/bin/sudo /usr/bin/docker network prune
/usr/bin/sudo rm -r Handlers/data/mariadb