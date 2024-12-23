# Discord Channel Cloner

## Overview
This project is a bot designed to clone messages from a specific channel on one Discord server to a channel on another server. The bot filters messages that tag a specific role and redirects them to the target channel with the tagged role replaced by a role in the new server. This acts as a filter to only transmit important messages, but the filtering can be easily adjusted to transfer all messages if needed.

In the new server, users can interact with transferred messages using commands to retrieve additional context in a discord thread:

- **before x**: Creates a thread containing the `x` messages preceding the transferred message.
- **after x**: Creates a thread containing the `x` messages following the transferred message.
- **more x y**: Creates a thread containing `x` preceding messages and `y` following messages.

## Key Features
- **Role Replacement**: Replaces role mentions in the source server with a corresponding role in the target server.
- **Message Filtering**: Only redirects messages with tagged roles, but customizable to transfer all messages.
- **Thread Context Commands**: Retrieve and display messages preceding, following, or surrounding a transferred message.
- **Reliable WebSocket Handling**:
   - Handling heartbeat ACKs.
   - Reconnecting and resuming sessions after disconnections.
   - Initial identification and reconnection after failed resume attempts.

## Setup and Configuration

### Prerequisites
- Node.js installed on your system.
- A Discord webhook token.
- A Discord account token ("spy token") from a user in the source server.

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/NathanRouille/Discord-Clone.git
   cd Discord-Clone
   ```
2. Install dependencies:
   ```bash
   npm install ws axios
   ```

### Configuration
1. Replace `your discord token` in the code with your "spy token".
2. Replace `webhook token` in the code with your webhook token.
3. Update the `targetChannelMap` and `reverseTargetChannelMap` with the appropriate channel IDs for source and target channels.
4. Set the `newRoleId` to the role ID that should be tagged in the cloned messages.

### Running the Bot
Start the bot:
```bash
node main.js
```

## Contributing
Contributions are welcome! Please fork the repository and submit a pull request with your changes.
