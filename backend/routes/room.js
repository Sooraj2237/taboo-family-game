const express = require('express');
const Room = require('../models/Room');
const router = express.Router();

const generateRoom = () => Math.random().toString(36).substring(2, 6).toUpperCase();

// Create Room route
router.post('/create', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ message: "A name is required to host." });

        const roomCode = generateRoom();

        const newRoom = new Room({
            roomCode,
            host: username,
            // UPDATED: Using the exact object structure required by the new Room.js model
            players: [{ username, team: 'Unassigned', role: 'Waiting' }] 
        });

        await newRoom.save();
        res.status(201).json({ roomCode, username, message: "Room created!" });
    } catch(error) {
        // ADDED: This will print the exact Mongoose crash reason to your terminal
        console.error("\n[DEBUG] CREATE ROOM ERROR:", error); 
        res.status(500).json({ message: "Server error creating room." });
    }
});

// Join Room route
router.post('/join', async (req, res) => {
    try {
        const { username, roomCode } = req.body;
        if (!username || !roomCode) return res.status(400).json({ message: "Name and Room Code required!" });

        const codeUpper = roomCode.toUpperCase();
        const room = await Room.findOne({ roomCode: codeUpper });

        if (!room) {
            return res.status(404).json({ message: "Room not found. Check the code!" })
        }

        // UPDATED: Checking inside the object array for name collisions
        if (room.players.some(p => p.username === username)) {
            return res.status(400).json({ message: "This name is already taken, try a different name!" })
        }

        // UPDATED: Pushing the full object
        room.players.push({ username, team: 'Unassigned', role: 'Waiting' });
        await room.save();

        res.status(200).json({ roomCode: codeUpper, username, message: "Joined Successfully!" });
    } catch(error) {
        // ADDED: Printing the exact join error to your terminal
        console.error("\n[DEBUG] JOIN ROOM ERROR:", error);
        res.status(500).json({ message: "Server error joining room." });
    }
});

module.exports = router;