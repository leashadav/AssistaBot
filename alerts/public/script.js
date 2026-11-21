// DOM Elements
const alertsContainer = document.getElementById('alerts');
const alertSound = document.getElementById('alertSound');
const streamSpeechAudio = document.getElementById('streamSpeechAudio');
const connectionStatus = document.getElementById('connection-status');

// WebSocket connection variables
let ws = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelay = 3000; // 3 seconds

// Sound enabled state
let soundEnabled = false;
let pendingSpeech = [];
let voiceEnableButton = null;
let speechPlaying = false;
let speechPlaybackLocked = false;

function speakStreamAudio(audioUrl) {
    let url;
    try {
        url = new URL(audioUrl, window.location.href);
    } catch (error) {
        console.error('[Alerts] Invalid stream speech audio URL:', error.message);
        updateConnectionStatus('Voice announcement has an invalid audio URL.', true);
        return;
    }

    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/speech-audio/')) {
        updateConnectionStatus('Voice announcement audio URL is not allowed.', true);
        return;
    }

    pendingSpeech.push(url.href);
    if (pendingSpeech.length > 20) pendingSpeech.shift();
    playNextSpeech();
}

function playNextSpeech() {
    if (!streamSpeechAudio || speechPlaying || speechPlaybackLocked || pendingSpeech.length === 0) return;
    streamSpeechAudio.src = pendingSpeech.shift();
    streamSpeechAudio.currentTime = 0;
    speechPlaying = true;
    streamSpeechAudio.play().then(() => {
        updateConnectionStatus('Stream voice announcement is playing.');
        if (voiceEnableButton) {
            voiceEnableButton.remove();
            voiceEnableButton = null;
        }
    }).catch(error => {
        speechPlaying = false;
        speechPlaybackLocked = true;
        pendingSpeech.unshift(streamSpeechAudio.src);
        console.error('[Alerts] Stream speech playback failed:', error.message);
        updateConnectionStatus('Click the overlay once to enable voice announcements.', true);
        showVoiceEnableButton();
    });
}

if (streamSpeechAudio) {
    streamSpeechAudio.addEventListener('ended', () => {
        speechPlaying = false;
        updateConnectionStatus('');
        playNextSpeech();
    });
    streamSpeechAudio.addEventListener('error', () => {
        speechPlaying = false;
        console.error('[Alerts] Failed to load or decode stream speech audio.');
        updateConnectionStatus('Voice audio could not be loaded or decoded.', true);
        playNextSpeech();
    });
}

function enableSpeechPlayback() {
    speechPlaybackLocked = false;
    if (voiceEnableButton) {
        voiceEnableButton.remove();
        voiceEnableButton = null;
    }
    playNextSpeech();
}

function showVoiceEnableButton() {
    if (voiceEnableButton || !document.body) return;
    voiceEnableButton = document.createElement('button');
    voiceEnableButton.textContent = '🔊 Enable voice announcements';
    voiceEnableButton.style.position = 'fixed';
    voiceEnableButton.style.bottom = '10px';
    voiceEnableButton.style.left = '10px';
    voiceEnableButton.style.padding = '6px 10px';
    voiceEnableButton.style.zIndex = '1000';
    voiceEnableButton.onclick = enableSpeechPlayback;
    document.body.appendChild(voiceEnableButton);
}

// Update connection status display
function updateConnectionStatus(message, isError = false) {
    if (!connectionStatus) return;
    
    connectionStatus.textContent = message;
    
    // Only show the status element if there's an error or a non-empty message
    if (isError || message) {
        connectionStatus.style.display = 'block';
        connectionStatus.style.background = isError ? 'rgba(255,0,0,0.7)' : 'rgba(0,0,0,0.7)';
    } else {
        // Hide the status element if there's no message and no error
        connectionStatus.style.display = 'none';
    }
    
}

// Enable sound when user interacts with the page
function enableSound() {
    enableSpeechPlayback();
    if (alertSound) {
        // Use muted playback to unlock audio without playing a donation alert.
        alertSound.muted = true;
        alertSound.volume = 1.0;
        const playPromise = alertSound.play();
        
        if (playPromise !== undefined) {
            playPromise.then(() => {
                alertSound.pause();
                alertSound.currentTime = 0;
                alertSound.muted = false;
                soundEnabled = true;
            }).catch(() => {
                alertSound.muted = false;
            });
        } else {
            alertSound.muted = false;
            soundEnabled = true;
        }
    }
}

// Enable sound on any user interaction
document.addEventListener('click', enableSound, { once: true });

// Debug functions
const debug = {
    // Test alert with custom message
    testAlert: function(message = 'Test alert! 🚨') {
        showAlert({
            name: 'Test User',
            amount: '5.00',
            currency: 'USD',
            message: message,
            isTest: true
        });
    },
    
    // Check WebSocket connection
    checkConnection: function() {
        if (!window.ws) {
            // Not connected, attempting to connect
            connectWebSocket();
            return;
        }
        
        const states = {
            0: 'CONNECTING',
            1: 'OPEN',
            2: 'CLOSING',
            3: 'CLOSED'
        };
        
        if (window.ws.readyState !== WebSocket.OPEN) {
            // Attempting to reconnect WebSocket
            connectWebSocket();
        }
    },
    
    // Test sound
    testSound: function() {
        // Testing alert sound
        playAlertSound();
    },
    
    // Force reconnect
    reconnect: function() {
        if (window.ws) {
            window.ws.close();
        }
        // Reconnecting WebSocket
        connectWebSocket();
    }
};

// Make debug functions globally accessible
window.debug = debug;

// Debug function to log WebSocket state
function logWebSocketState() {
    if (!window.ws) {
        // WebSocket not initialized
        return;
    }
    const states = {
        0: 'CONNECTING',
        1: 'OPEN',
        2: 'CLOSING',
        3: 'CLOSED'
    };
    // WebSocket state logged
}

// Play alert sound
function playAlertSound() {
    const alertSound = document.getElementById('alertSound');
    if (!alertSound) {
        // Alert sound element not found
        return;
    }
    
    // Ensure sound is unmuted
    alertSound.muted = false;
    alertSound.volume = 1.0;
    
    // Reset and play
    alertSound.currentTime = 0;
    const playPromise = alertSound.play();
    
    if (playPromise !== undefined) {
        playPromise.catch(error => {
            // Autoplay prevented, showing enable button
            // Show a button to enable sound
            const enableBtn = document.createElement('button');
            enableBtn.textContent = '🔊 Enable Sound';
            enableBtn.style.position = 'fixed';
            enableBtn.style.bottom = '10px';
            enableBtn.style.left = '10px';
            enableBtn.style.padding = '5px 10px';
            enableBtn.style.zIndex = '1000';
            enableBtn.onclick = () => {
                document.body.removeChild(enableBtn);
                alertSound.play().catch(() => {});
            };
            document.body.appendChild(enableBtn);
        });
    }
}

function connectWebSocket() {
    try {
        // Close existing connection if any
        if (ws) {
            // Closing existing WebSocket connection
            ws.close();
        }
        
        // Construct WebSocket URL
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/ws?role=alerts`;
        
        // Connecting to WebSocket
        updateConnectionStatus('Connecting to server...');
        
        // Create new WebSocket connection
        ws = new WebSocket(wsUrl);
        window.ws = ws; // Expose for debugging
        
        // Set binary type to improve performance
        ws.binaryType = 'arraybuffer';
        
        ws.onopen = (event) => {
            // WebSocket connection established
            reconnectAttempts = 0;
            
            // Update status and then hide it after a short delay
            updateConnectionStatus('Connected', false);
            setTimeout(() => {
                updateConnectionStatus('', false); // This will hide the status
            }, 2000); // Hide after 2 seconds
            
            logWebSocketState();
            
            // Send a ping to verify the connection
            try {
                ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            } catch (error) {
                // Error sending ping
            }
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.type === 'pong') {
                    return;
                }
                
                if (data.type === 'connection') {
                    return;
                }

                if (data.type === 'speech') {
                    speakStreamAudio(data.audioUrl);
                    return;
                }

                // Handle donation alert
                if (data.type === 'donation' || data.amount) {
                    showAlert(data);
                }
            } catch (error) {
                // Error processing message
            }
        };
        
        ws.onclose = (event) => {
            const closeMessage = `Connection closed${event.reason ? `: ${event.reason}` : ''} (Code: ${event.code})`;
            updateConnectionStatus(closeMessage, true);
            logWebSocketState();
            
            // Try to reconnect
            if (reconnectAttempts < maxReconnectAttempts) {
                const delay = Math.min(reconnectDelay * Math.pow(1.5, reconnectAttempts), 30000); // Max 30s delay
                const attempt = reconnectAttempts + 1;
                const status = `Reconnecting in ${Math.ceil(delay/1000)}s... (${attempt}/${maxReconnectAttempts})`;
                updateConnectionStatus(status);
                
                reconnectTimer = setTimeout(() => {
                    connectWebSocket();
                }, delay);
                
                reconnectAttempts++;
            } else {
                const errorMsg = 'Max reconnection attempts reached. Please refresh the page.';
                updateConnectionStatus(errorMsg, true);
            }
        };
        
        ws.onerror = (error) => {
            updateConnectionStatus('Connection error', true);
            logWebSocketState();
        };
        
    } catch (error) {
        // Error creating WebSocket connection
        attemptReconnect();
    }
}

function attemptReconnect() {
    if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = reconnectDelay * Math.pow(2, reconnectAttempts - 1);
        setTimeout(() => {
            if (ws && (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING)) {
                connectWebSocket();
            }
        }, delay);
    } else {
        // Max reconnection attempts reached
    }
}

function showAlert(donation) {
    if (!donation) {
        return;
    }
    
    // Create alert element
    const alert = document.createElement('div');
    alert.className = 'alert';
    alert.innerHTML = `
        <div class="alert-header">
            <span class="alert-icon">🎉</span>
            <h3>${donation.isTest ? 'Test ' : ''}New Donation!</h3>
        </div>
        <p><strong>${donation.name || 'Anonymous'}</strong> donated 
           <span class="alert-amount">${donation.amount || '0.00'} ${donation.currency || 'USD'}</span></p>
        ${donation.message ? `<p class="alert-message">"${donation.message}"</p>` : ''}
    `;
    
    // Add to container
    if (!alertsContainer) {
        return;
    }
    
    alertsContainer.prepend(alert);
    
    // Play sound if this is not a test or if it's explicitly a test alert
    if (!donation.isTest || donation.isTest) {
        playAlertSound();
    }
    
    // Trigger animation
    setTimeout(() => {
        alert.classList.add('show');
    }, 100);
    
    // Remove after 8 seconds
    setTimeout(() => {
        alert.classList.remove('show');
        
        // Wait for animation to complete before removing from DOM
        setTimeout(() => {
            if (alert.parentNode === alertsContainer) {
                alertsContainer.removeChild(alert);
            }
        }, 500);
    }, 8000);
}

// Initialize when DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // DOM fully loaded, initializing WebSocket
    connectWebSocket();
    
    // Expose functions for debugging
    window.showAlert = showAlert;
    
    // Test alert function
    window.testAlert = function() {
        showAlert({
            name: 'Test User',
            amount: (Math.random() * 100).toFixed(2),
            currency: 'USD',
            message: 'This is a test alert! 🎉',
            isTest: true
        });
    };
    
    // Alert system ready
});