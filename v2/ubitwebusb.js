//adapted and simplified for AHO students
//based on ubitwebusb.js by Bill Siever https://github.com/bsiever/microbit-webusb

//new funcs
////////////////////////////////////////////////////////////////////////

let connectBtn;  //the conect button
let connectedDevice; //variable to store info about the connection

function uBitWriteLine(data){ //simplified send only takes string
  if(connectedDevice != null){
  uBitSend(connectedDevice,data);
  }else{
    print("device not connxected!");
  }
}

function setupuBitSerial(){
  connectBtn = createButton("connect to microbit");
  connectBtn.mousePressed(connectuBit); // function to call upon button being clicked
  connectBtn.position(0,0);
}

function connectuBit() {
  uBitConnectDevice(uBitEventHandler);
}

function disconnectuBit() {
  uBitDisconnect(connectedDevice);
}

function uBitEventHandler(reason, device, data) {
  //console.log("ooh!");
  switch (reason) {
      
    case "connected":
      if(CONSOLE_LOG) print("connected");
      connectedDevice = device;
      connectBtn.hide();
      break
      
    case "disconnected":
      if(CONSOLE_LOG) print("disconnected");
      connectedDevice = null;
      connectBtn.show()
      break
        
    case "console": // we received a string
      if(LOG_ALL_DATA) {print("Console Data: " + data.data)}
      if (typeof onReceivedString === 'function') {
        onReceivedString(data.data);
      } else {
        //console.log('The function does not exist.');
      }
      break
      
    case "graph-data": // we received a value
      if(CONSOLE_LOG) print(`Graph Data: ${data.data} (for ${data.graph}${data.series.length?" / series "+data.series:""})`)
      if(typeof onReceivedValue === 'function'){
        onReceivedValue(data.graph, data.data)  
      } else {
        //console.log(data.graph + " = " + data.data)
      }      
      break
  }
}

//end of new funcs
////////////////////////////////////////////////////////////////////////

  
  
/*
 * based on bsievers library https://github.com/bsiever/microbit-webusb
 * JavaScript functions for interacting with micro:bit microcontrollers over WebUSB
 * (Only works in Chrome browsers;  Pages must be either HTTPS or local)
 *
 * The transport is DAPjs (dap.umd.js, loaded by index.html just before this
 * file), as in Bill's own "Updated to DAP.js / support for v2.2". The old one
 * spoke raw HID control transfers to a hardcoded interface 4, which the DAPLink
 * firmware on V2.21 boards no longer exposes - so it only ever worked on V2.00.
 * Ported from /Users/daniel/p5js-webstepseq/ubitwebusb.js, tested there.
 */

const MICROBIT_VENDOR_ID = 0x0d28
const MICROBIT_PRODUCT_ID = 0x0204

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
        // sketch.js's onMicrobitEvent already treats this as "not connected"
        callback("connection failure", device, error)
        return
    }
    device.target = target;   // Store the target in the device object (needed for write)
    device.callback = callback // Store the callback for the device
    callback("connected", device, null)

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
            } else {
                // Not a graph format.  Send it as a console bundle
                let dataBundle = {time: now, data: messageToNewline}
                callback("console", device, dataBundle)
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
    // sketch.js's disconnectMicrobit() - so the callback is taken first and
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
    if(!device || !device.opened || !device.target)
        return
    let fullLine = data+'\n'
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
