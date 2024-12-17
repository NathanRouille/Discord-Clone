const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

let ws; // WebSocket connection
let heartbeatInterval = null; // ID for the Heartbeat interval
let expectHeartbeatAck = false; // To check if we received a Heartbeat ACK
const baseGatewayUrl = 'wss://gateway.discord.gg/?v=9&encoding=json'; // Base URL
let resumeGatewayUrl = baseGatewayUrl; // Will be updated with the one from READY event

let sessionId = null; // Session ID for resuming sessions
let sequenceNumber = null; // Sequence number for Heartbeats

const token = "your discord token";

const headers = {
  authorization: `webhook token`,
  "content-type": "application/json",
};

const targetChannelMap = {
  "id_channel_to_clone_1" : "id_channel_cloned_1",
  "id_channel_to_clone_2" : "id_channel_cloned_2",
};

const reverseTargetChannelMap = {
   "id_channel_cloned_1" : "id_channel_to_clone_1",
   "id_channel_cloned_2" : "id_channel_to_clone_2",
};

const newRoleId = "role to tag in the cloned channel";
const newRoleTag = `<@&${newRoleId}>`;

const messageMap = new Map();

function addMessageMapEntry(originalMessageId, redirectedMessageId) {
  messageMap.set(originalMessageId, redirectedMessageId);

  if (messageMap.size > 1000) {
      const keysIterator = messageMap.keys();
      for (let i = 0; i < 100; i++) {
          const firstKey = keysIterator.next().value;
          messageMap.delete(firstKey);
      }
  }
}

const channelMessagesHistory = new Map();

function addMessageToHistory(channelId, message) {
    if (!channelMessagesHistory.has(channelId)) {
        channelMessagesHistory.set(channelId, []);
    }
    let history = channelMessagesHistory.get(channelId);
    history.push(message);

    if (history.length > 1000) {
      for (let i = 0; i < 100; i++) {
        history.shift();
      }
    }
}

let messageThreadMap = new Map();

async function handleCommand(channelId, messageId, numMessages,command,numMessagesMore = 0) {
  if (isNaN(numMessages) || numMessages <= 0) return; 

  const history = channelMessagesHistory.get(channelId);
  if (!history) return;

  const existingThread = messageThreadMap.get(messageId);

  if (existingThread) {
    try {
      await axios.delete(`https://discord.com/api/v9/channels/${existingThread.threadId}`, { headers });
    } catch (error) {
      console.error(`Erreur lors de la suppression du thread ${existingThread.threadId}:`, error);
      addLog(`Erreur lors de la suppression du thread ${existingThread.threadId}: ${error}`);
    }
    messageThreadMap.delete(messageId);
  }

  const messageIndex = history.findIndex(m => m.id === messageId);
  if (messageIndex === -1) return;

  let messagesToRedirect = [];
  switch (command) {
    case 'before':
      messagesToRedirect = history.slice(Math.max(0, messageIndex - numMessages), messageIndex);
      if (messagesToRedirect.length < numMessages) {
        messagesToRedirect.unshift({ content: "**pas de message précédent**", author: "bot call"  }); // Add before
      }
      break;
    case 'after':
      messagesToRedirect = history.slice(messageIndex + 1, Math.min(history.length, messageIndex + 1 + numMessages));
      if (messagesToRedirect.length < numMessages) {
        messagesToRedirect.push({ content: "**pas de message suivant**", author: "bot call" }); // Add after
      }
      break;
    case 'more':
      if (isNaN(numMessagesMore) || numMessagesMore <= 0) return;
      messagesToRedirect = history.slice(Math.max(0, messageIndex - numMessages), messageIndex);
      if (messagesToRedirect.length < numMessages) {
        messagesToRedirect.unshift({ content: "**pas de message précédent**", author: "bot call" });
      }
      messagesToRedirect.push({ content: "**message call**", author: "bot call" });
      const messagesAfter = history.slice(messageIndex + 1, Math.min(history.length, messageIndex + 1 + numMessagesMore));
      if (messagesAfter.length < numMessagesMore) {
          messagesAfter.push({ content: "**pas de message suivant**", author: "bot call" });
      }
      messagesToRedirect = messagesToRedirect.concat(messagesAfter);
      break; 
    default:
      return; // Or send a message saying the command is invalid
  }

  const targetChannelThreadId = targetChannelMap[channelId];
  const messageThreadId = messageMap.get(messageId)
  const url = `https://discord.com/api/v9/channels/${targetChannelThreadId}/messages/${messageThreadId}/threads`;

  const data = {
    name: `extend call`,
    auto_archive_duration: 1440,
      type: 11,
  };

  try {
      const response = await axios.post(url, data, { headers });
      for (const msg of messagesToRedirect) {
        let content_thread = {
          content: `${msg.content} (${msg.author})`,
        };
        try {
          const response_mess_thread = await axios.post(`https://discord.com/api/v9/channels/${response.data.id}/messages`, content_thread, { headers });
          messageThreadMap.set(messageId, {threadId: response_mess_thread.data.channel_id });
        } catch (error) {
          console.error("Erreur lors de l'envoie dans le thread :", error);
          addLog(`Erreur lors de l'envoie dans le thread : ${error}`);
        }
      }
      return response.data;
  } catch (error) {
      console.error('Erreur lors de la création du thread:', error);
      addLog(`Erreur lors de la création du thread: ${error}`);
  }

}


function findKeyByValue(map, searchValue) {
  for (let [key, value] of map.entries()) {
    if (value === searchValue) {
      return key;
    }
  }
  return undefined;
}

const logFilePath = path.join(__dirname, 'botLog.txt');

function addLog(message) {
  const timestamp = new Date().toLocaleString();
  const logEntry = `[${timestamp}] ${message}\n`;

  fs.appendFile(logFilePath, logEntry, (err) => {
    if (err) {
      console.error('Erreur lors de l\'écriture du log:', err);
    }
  });
}

// Initial connection to the WebSocket
function connectToGateway(resume = false) {
  const url = resume ? resumeGatewayUrl : baseGatewayUrl;
  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('Connected to Discord WebSocket');
    addLog('Connected to Discord WebSocket');
    if (resume) {
        resumeSession();
      }
  });

  ws.on('message', (data) => {
    const response = JSON.parse(data);
    
    if (response.s) sequenceNumber = response.s; // Update the last sequence number

    switch (response.op) {
      case 10: // Hello
        handleHello(response.d.heartbeat_interval);
        break;
      case 11: // Heartbeat ACK
        expectHeartbeatAck = false;
        break;
      case 1:
        sendHeartbeat();
        break
      case 7:
        console.log('Need to resume...');
        addLog('Need to resume...');
        ws.close(4000);
        break
      case 9: // Invalid Session
        console.log('Invalid session, reconnecting with Identify...');
        addLog('Invalid session, reconnecting with Identify...');
        const closeCode = response.d ? 4000 : 1000;
        ws.close(closeCode);
        break;
      case 0: // Dispatch
        if (response.t === "MESSAGE_CREATE") {
          handleMessage(response.d);
        }else if (response.t === "READY") {
          sessionId = response.d.session_id;
          resume_gateway_url = response.d.resume_gateway_url;
        }
        break;
      default:
        break;
    }
  });

  ws.on('close', (code) => {
    console.log(`WebSocket disconnected with code ${code}, attempting to reconnect...`);
    addLog(`WebSocket disconnected with code ${code}, attempting to reconnect...`);
    clearInterval(heartbeatInterval); // Stop Heartbeats
    const resumeCodes = [4000, 4001, 4002, 4003, 4005, 4006, 4007, 4008, 4009];
    const canResume = typeof code === 'undefined' || resumeCodes.includes(code);
    setTimeout(() => connectToGateway(canResume), 5000);
  });
}

// Handle sending Heartbeats
function handleHello(heartbeat_interval) {
  heartbeatInterval = setInterval(() => {
    if (expectHeartbeatAck) {
      console.log('Heartbeat ACK not received, trying to resume');
      addLog('Heartbeat ACK not received, trying to resume');
      ws.close(4000); // Close with code to indicate a controlled reconnect
      return;
    }
    sendHeartbeat();
    expectHeartbeatAck = true;
  }, heartbeat_interval);

  identify();
}

// Send a Heartbeat
function sendHeartbeat() {
  ws.send(JSON.stringify({ op: 1, d: sequenceNumber }));
}

function identify() {
  let payload = {
    op: 2,
    d: {
      token: token,
      properties: {
        $os: "linux",
        $browser: "chrome",
        $device: "chrome"
      },
    }
  };

  ws.send(JSON.stringify(payload));
}

function resumeSession() {
  console.log('Tentative de reprise de la session...');
  addLog('Tentative de reprise de la session...');
  ws.send(JSON.stringify({
    op: 6, // Opcode pour Resume
    d: {
      token: token,
      properties: {
        $os: "linux",
        $browser: "chrome",
        $device: "chrome"
      },
      session_id: sessionId,
      seq: sequenceNumber
    }
  }));
}

async function handleMessage(m) {
  const targetChannelId = targetChannelMap[m.channel_id];
  const reverseTargetChannelId = reverseTargetChannelMap[m.channel_id];

  if (targetChannelId) {

    let content = m.content ? m.content : { embeds: [m.embeds[0]] };

    const containsRoleTag = /<@&\d+>/.test(content);

    addMessageToHistory(m.channel_id, {
      id: m.id,
      content: m.content,
      author: m.author.username
    });

    if (containsRoleTag) {
      content = content.replace(/<@&\d+>/g, newRoleTag);

      const authorName = m.author.username;
      content += ` (${authorName})`;

      let content_discord = {
        content: content,
      };

      if (m.message_reference && messageMap.has(m.message_reference.message_id)) {
        content_discord.message_reference = { message_id: messageMap.get(m.message_reference.message_id)};
      }

      try {
        const response = await axios.post(`https://discord.com/api/v9/channels/${targetChannelId}/messages`, content_discord, { headers });
        addMessageMapEntry(m.id,response.data.id)
      } catch (error) {
        console.error("Erreur lors de la redirection du message:", error);
        addLog(`Erreur lors de la redirection du message : ${error}`);
      }
    }
  }
  else if (reverseTargetChannelId && m.message_reference) {
    const beforeMatch = m.content.match(/^before (\d+)/i);
    const afterMatch = m.content.match(/^after (\d+)/i);
    const moreMatch = m.content.match(/^more (\d+) (\d+)/i);
    if (beforeMatch) {
      const numMessages = parseInt(beforeMatch[1], 10);
      const originalMessageId = findKeyByValue(messageMap,m.message_reference.message_id);    
      await handleCommand(reverseTargetChannelId, originalMessageId, numMessages, 'before');
    }else if (afterMatch) {
      const numMessages = parseInt(afterMatch[1], 10);
      const originalMessageId = findKeyByValue(messageMap,m.message_reference.message_id);    
      await handleCommand(reverseTargetChannelId, originalMessageId, numMessages, 'after');
    }else if (moreMatch) {
      const numMessagesBefore = parseInt(moreMatch[1], 10);
      const numMessagesAfter = parseInt(moreMatch[2], 10);
      const originalMessageId = findKeyByValue(messageMap, m.message_reference.message_id);
      await handleCommand(reverseTargetChannelId, originalMessageId, numMessagesBefore, 'more', numMessagesAfter);
  }
  }
}

connectToGateway();
