/*
 * JavaScript functions for interacting with micro:bit microcontrollers over WebUSB
 * (Only works in Chrome/Edge;  Pages must be either HTTPS or localhost)
 *
 * Shared by Microbit Orchestra Hero 2 and p5js-webstepseq. The canonical copy
 * lives in "mBorch repair/web/" - edit it there and run sync.sh, so the two
 * apps never drift apart again.
 *
 * Based on ubitwebusb.js by Bill Siever https://github.com/bsiever/microbit-webusb
 * The transport is DAPjs (dap.umd.js, must be loaded before this file), as in
 * Bill's own "Updated to DAP.js / support for v2.2". The old one spoke raw HID
 * control transfers to a hardcoded interface 4, which the DAPLink firmware on
 * V2.21 boards no longer exposes - so it only ever worked on V2.00.
 *
 * connectedDevice is NOT declared here: each app declares it itself
 * (let connectedDevice = null) in its sketch.js.
 *
 * Two ways to use it:
 *  - pass your own handler: uBitConnectDevice(myHandler) - Hero does this
 *  - or use the default one: connect() / send() / uBitWriteLine() - webstepseq
 *    does this. Incoming lines are passed on to whichever of these the app
 *    defines: handleUsbData(line) / onReceivedString(line), onReceivedValue(name, value)
 */


const MICROBIT_VENDOR_ID = 0x0d28
const MICROBIT_PRODUCT_ID = 0x0204

// ---- the serial log -------------------------------------------------------
// What actually went down the wire, and what came back, when DEBUG_SERIAL is
// on. Strings are shown as JSON so a newline reads as \n rather than as a
// line break, and anything unprintable is shown by code - an invisible
// character in a command is otherwise impossible to see.
function serialLog(arrow, text, note) {
  if (typeof DEBUG_SERIAL === "undefined" || !DEBUG_SERIAL) return;
  const s = String(text);
  const odd = [...s].some(c => c.charCodeAt(0) < 32 && c !== "\n" && c !== "\r");
  const codes = odd ? "  codes: " + [...s].map(c => c.charCodeAt(0)).join(" ") : "";
  console.log(`micro:bit ${arrow} ${JSON.stringify(s)}${note ? "  " + note : ""}${codes}`);
}

// The letters this build is really using, printed on connect. See DEBUG_SERIAL
// in Hero's config.js for why that is worth knowing.
function serialLogCommands() {
  if (typeof DEBUG_SERIAL === "undefined" || !DEBUG_SERIAL) return;
  const reset = typeof MICROBIT_RESET_SCORES !== "undefined" ? MICROBIT_RESET_SCORES : "?";
  const ask = typeof MICROBIT_REQUEST_SCORES !== "undefined" ? MICROBIT_REQUEST_SCORES : "?";
  console.log(`micro:bit commands in this build: A/B/X to play, ` +
              `${JSON.stringify(reset)} reset scores, ${JSON.stringify(ask)} request scores`);
}
// ---------------------------------------------------------------------------

let CONSOLE_LOG = false;
let LOG_ALL_DATA = false;

/*
   Open and configure a selected device and then start the serial read
 */
async function uBitOpenDevice(device, callback) {
    const transport = new DAPjs.WebUSB(device)
    const target = new DAPjs.DAPLink(transport)
    try {
        await target.connect()
        await target.setSerialBaudrate(115200)
    } catch (error) {
        // handlers treat this as "not connected"
        callback("connection failure", device, error)
        return
    }
    device.target = target;   // Store the target in the device object (needed for write)
    device.callback = callback // Store the callback for the device
    callback("connected", device, null)
    serialLogCommands()

    let lineParser = () => {
        let firstNewline = buffer.indexOf("\n")
        if(firstNewline>=0) {
            let messageToNewline = buffer.slice(0,firstNewline)
            let now = new Date()
            // Deal with line
            // If it's a graph/series format, break it into parts
            let parseResult = parser.exec(messageToNewline)
            if(parseResult) {
                let graph = parseResult[1]
                let series = parseResult[2]
                let data = parseResult[3]
                let callbackType = "graph-event"
                // If data is numeric, it's a data message and should be sent as numbers
                if(!isNaN(data)) {
                    callbackType = "graph-data"
                    data = parseFloat(data)
                }
                // Build and send the bundle
                let dataBundle = {
                    time: now,
                    graph: graph,
                    series: series,
                    data: data
                }
                callback(callbackType, device, dataBundle)
                serialLog("<-", messageToNewline, `read as ${callbackType}: ${JSON.stringify(graph)} = ${JSON.stringify(data)}`)
            } else {
                // Not a graph format.  Send it as a console bundle
                let dataBundle = {time: now, data: messageToNewline}
                callback("console", device, dataBundle)
                serialLog("<-", messageToNewline, "read as console (no colon in it)")
            }
            buffer = buffer.slice(firstNewline+1)  // Advance to after newline
            firstNewline = buffer.indexOf("\n")    // See if there's more data
            // Schedule more parsing
            if(firstNewline>=0) {
                setTimeout(lineParser, 10)
            }
        }
    }

    let buffer=""                               // Buffer of accumulated messages
    const parser = /([^.:]*)\.*([^:]+|):(.*)/   // Parser to identify time-series format (graph:info or graph.series:info)
    const ws = / *\r\n/g
    target.on(DAPjs.DAPLink.EVENT_SERIAL_DATA, data => {
        buffer += data;
        buffer = buffer.replace(ws, "\n")
        if(data.includes("\n"))
            setTimeout(lineParser, 10)
    });
    target.startSerialRead(1)
}

/**
 * Disconnect from a device
 * @param {USBDevice} device to disconnect from
 */
async function uBitDisconnect(device) {
    // Can be asked twice for one unplug - the USB disconnect event below and
    // the app's own disconnect - so the callback is taken first and
    // a second call finds nothing to do.
    if(!device || !device.callback)
        return
    let callback = device.callback
    device.callback = null
    try {
        await device.target.stopSerialRead()
    } catch(error) {
        // Failure may mean already stopped
    }
    try {
        await device.target.disconnect()
    } catch(error) {
        // Failure may mean already disconnected
    }
    try {
        await device.close()
    } catch(error) {
        // Failure may mean already closed
    }
    // Call the callback with notification of disconnect
    callback("disconnected", device, null)
    device.target = null
}

/**
 * Send a string to a specific device
 * @param {USBDevice} device
 * @param {string} data to send (must not include newlines)
 */
function uBitSend(device, data) {
    // A send can arrive before connect() has finished, or after an unplug.
    // Logged either way: a command that went nowhere looks exactly like one
    // the micro:bit ignored, and they need telling apart.
    if(!device || !device.opened || !device.target) {
        serialLog("->", data + "\n", "NOT SENT - no micro:bit connected")
        return
    }
    let fullLine = data+'\n'
    serialLog("->", fullLine)
    device.target.serialWrite(fullLine)
}


/**
 * Callback for micro:bit events
 *

   Event data varies based on the event string:
  <ul>
   <li>"connection failure": null, or the error when the device was chosen but would not connect</li>
   <li>"connected": null</li>
   <li>"disconnected": null</li>
   <li>"error": error object</li>
   <li>"console":  { "time":Date object "data":string}</li>
   <li>"graph-data": { "time":Date object "graph":string "series":string "data":number}</li>
   <li>"graph-event": { "time":Date object "graph":string "series":string "data":string}</li>
  </ul>

 * @callback uBitEventCallback
 * @param {string} event ("connection failure", "connected", "disconnected", "error", "console", "graph-data", "graph-event" )
 * @param {USBDevice} device triggering the callback
 * @param {*} data (event-specific data object). See list above for variants
 *
 */


/**
 * Allow users to select a device to connect to.
 *
 * @param {uBitEventCallback} callback function for device events
 */
function uBitConnectDevice(callback) {
    navigator.usb.requestDevice({filters: [{ vendorId: MICROBIT_VENDOR_ID, productId: MICROBIT_PRODUCT_ID }]})
        .then(  d => { if(!d.opened) uBitOpenDevice(d, callback)} )
        .catch( () => callback("connection failure", null, null))
}

// Unplugging the micro:bit. The one listener: only devices this file opened
// carry a callback, so anything else unplugged is ignored.
if (navigator.usb) {
    navigator.usb.addEventListener('disconnect', (event) => {
        if("device" in event && event.device.callback && (event.device.productName || "").includes("micro:bit")) {
            uBitDisconnect(event.device)
        }
    })
}


// ---- default handler and helpers -------------------------------------------

// The handler connect() uses. An app with its own handler never runs this.
function uBitEventHandler(reason, device, data) {
  switch (reason) {
    case "connected":
      if(CONSOLE_LOG) console.log("micro:bit connected");
      connectedDevice = device;
      break
    case "disconnected":
      if(CONSOLE_LOG) console.log("micro:bit disconnected");
      connectedDevice = null;
      break
    case "connection failure":
      if(CONSOLE_LOG) console.log("micro:bit connection failure", data);
      break
    case "error":
      if(CONSOLE_LOG) console.log("micro:bit error", data);
      break
    case "console": // a line with no colon in it
      if(LOG_ALL_DATA) console.log("Console Data: " + data.data)
      if (typeof handleUsbData === "function") handleUsbData(data.data);
      if (typeof onReceivedString === "function") onReceivedString(data.data);
      break
    case "graph-event": // "name:value" where value is not a number
    case "graph-data":  // "name:value" where value is a number
      if(LOG_ALL_DATA) console.log(`Graph: ${data.graph} = ${data.data}`)
      if (typeof onReceivedValue === "function") onReceivedValue(data.graph, data.data);
      break
  }
}

function connect() {
  uBitConnectDevice(uBitEventHandler);
}

function disconnect() {
  uBitDisconnect(connectedDevice);
  connectedDevice = null
}

// send a line to the connected micro:bit, if there is one
function send(data) {
  if(connectedDevice != null) {
    uBitSend(connectedDevice, data);
  } else {
    serialLog("->", data + "\n", "NOT SENT - no micro:bit connected")
  }
}

function uBitWriteLine(data) {
  send(data);
}
