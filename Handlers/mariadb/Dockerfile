FROM mariadb:latest
COPY ssl.cnf /etc/mysql/conf.d/ssl.cnf
COPY ./certs/server.crt /etc/mysql/ssl/server.crt
COPY ./certs/server.key /etc/mysql/ssl/server.key
COPY ./certs/ca.crt /etc/mysql/ssl/ca.crt
RUN chown -R mysql:mysql /etc/mysql/ssl \
    && chmod 644 /etc/mysql/ssl/*.crt \
    && chmod 600 /etc/mysql/ssl/*.key