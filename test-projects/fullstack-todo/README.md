# fullstack-todo

React (Vite) front end + Express API + MongoDB.

## Run locally
1. Start MongoDB on `localhost:27017`.
2. `cd backend && npm install && npm start` (API on port 4000).
3. `cd frontend && npm install && npm run dev`.

## Configuration
The API reads `MONGO_URI` (default `mongodb://localhost:27017/todos`) and `PORT` (default 4000).
The front end calls the API at `http://localhost:4000` (see `frontend/src/api.js`).
