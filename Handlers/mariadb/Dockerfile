FROM mariadb:latest
COPY ssl.cnf /etc/mysql/conf.d/ssl.cnf
COPY  certs/* /etc/mysql/ssl/
RUN chown -R mysql:mysql /etc/mysql/ssl \
    && chmod 644 /etc/mysql/ssl/*.crt \
    && chmod 600 /etc/mysql/ssl/*.key