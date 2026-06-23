# Taboo Family Game 🗣️🚫

**🌟 [Play the Live Game Here]([https://your-deployed-link-goes-here.com](https://taboo-family-game.vercel.app/)) 🌟**

A full-stack, real-time multiplayer web version of the classic party game "**Taboo**" Create a room, invite your friends, and try to get your team to guess the main word without using any of the forbidden words!

## 🚀 Tech Stack

**Frontend:**
* React (Vite)
* Tailwind CSS
* React Router

**Backend:**
* Node.js & Express.js
* MongoDB (Mongoose)
* Socket.io *(for real-time room syncing - if applicable)*

**Deployed using**
* *Frontend* - Vercel
* *Backend* - Render

## 📂 Project Structure

This repository is a monorepo containing both the frontend and backend code.

* `/backend`: Node/Express server, Mongoose models (`Room`, `Card`), and API routes.
* `/frontend`: Vite + React application, Tailwind styling, and UI components (`Home`, `GameRoom`).

## 🛠️ Local Development Setup

To run this project locally, you will need [Node.js](https://nodejs.org/) and [MongoDB](https://www.mongodb.com/) installed on your machine.

### 1. Clone the repository
```bash
git clone https://github.com/<your-username>/taboo-family-game.git
cd taboo-family-game

```

### 2. Setup the Backend

Open a new terminal window:

```bash
cd backend
npm install

```

* Create a `.env` file in the `/backend` directory and add your MongoDB URI: `MONGO_URI=mongodb://localhost:27017/taboo`
* Run the seed script to populate the initial game cards: `node seed.js`
* Start the server: `npm start` (Runs on port 5000 by default)

### 3. Setup the Frontend

Open a second terminal window:

```bash
cd frontend
npm install

```

* Create a `.env` file in the `/frontend` directory: `VITE_API_URL=http://localhost:5000`
* Start the Vite development server: `npm run dev`

## 🎮 How to Play

1. **Create a Room:** One player creates a game room and shares the unique room code.
2. **Join a Room:** Friends use the room code to join the lobby.
3. **Gameplay:** The active player must describe the target word to their team without saying any of the listed "Taboo" words.
