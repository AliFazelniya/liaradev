import requests
from flask import Flask

app = Flask(__name__)


@app.route("/")
def index():
    return "Flask app without a requirements.txt"


@app.route("/ip")
def ip():
    return requests.get("https://api.ipify.org", timeout=5).text
