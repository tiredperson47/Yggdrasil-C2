#!/bin/bash

/usr/bin/sudo /usr/bin/docker stop redis yggdrasil-handler mariadb
/usr/bin/sudo /usr/bin/docker container prune
/usr/bin/sudo /usr/bin/docker builder prune
/usr/bin/sudo rm -r Handlers/data/mariadb