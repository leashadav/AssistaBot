const path = require('path');
const fs = require('fs');
const player = require('play-sound')({});

class SoundPlayer {
    constructor() {
        this.soundsDir = path.join(__dirname, '..', 'sounds');
        this.donationSound = path.join(this.soundsDir, 'donation.mp3');
        
        // Create sounds directory if it doesn't exist
        if (!fs.existsSync(this.soundsDir)) {
            fs.mkdirSync(this.soundsDir, { recursive: true });
        }
    }

    playSound(soundFile) {
        if (!fs.existsSync(soundFile)) {
            console.error(`Sound file not found: ${soundFile}`);
            return;
        }

        player.play(soundFile, (err) => {
            if (err) {
                console.error('Error playing sound:', err);
            }
        });
    }

    playDonationSound() {
        if (fs.existsSync(this.donationSound)) {
            this.playSound(this.donationSound);
        } else {
            console.log('Donation sound not found. Please add a donation.mp3 file to the sounds directory.');
            console.log('Expected path:', this.donationSound);
        }
    }
}

module.exports = new SoundPlayer();