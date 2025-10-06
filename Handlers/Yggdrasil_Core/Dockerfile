FROM python:3.10-slim

# Set the working directory inside the container
WORKDIR /app

# Copy the requirements file and install dependencies
COPY . .
RUN pip install -r requirements.txt
#RUN sudo apt install gunicorn

# Expose the port your Flask app runs on
EXPOSE 8000

# Define the command to run your Flask application
CMD gunicorn --workers 4 --bind 0.0.0.0:8000 --certfile /app/certs/cert.pem --keyfile /app/certs/key.pem --log-level debug app:app
