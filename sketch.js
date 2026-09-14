let timingOffset = 25
let page = "SETUP"
//let connectedDevice = "";
let fadeIn = 255;
let a
///////
let DEBUG = false;
let hitArrayA = [32, 36, 48, 52, 64, 68, 80, 84, 96, 100, 112, 116, 128, 132, 144, 146, 148, 150, 160, 164, 176, 180, 192, 196, 208, 212, 224, 228, 240, 244, 256, 260, 272, 274, 276, 278, 288, 304, 320, 336, 342, 352, 368, 400, 402, 406, 416, 448, 456, 480, 488, 496, 504, 512, 516, 520, 524, 528, 530, 532, 534, 536, 537, 538, 539, 540, 541, 542, 543, 548, 560, 564, 576, 580, 592, 596, 608, 612, 624, 628, 640, 644, 656, 658, 660, 662, 672, 688, 704, 720, 726, 736, 752, 784, 786, 790, 800, 832, 840, 864, 872, 880, 888, 896, 900, 904, 908, 912, 914, 916, 918, 920, 921, 922, 923, 924, 925, 926, 927]
let latencyComp = 1;
let hitArrayAindex = 0;
let hitArrayB = [40, 56, 72, 88, 104, 120, 136, 152, 168, 184, 200, 216, 232, 248, 264, 274, 280, 296, 312, 328, 344, 350, 360, 376, 392, 408, 412, 432, 464, 504, 506, 508, 510, 528, 540, 541, 542, 543, 552, 568, 584, 600, 616, 632, 648, 664, 680, 690, 696, 712, 728, 744, 760, 766, 776, 792, 808, 824, 828, 848, 880, 920, 922, 924, 926, 944, 956, 957, 958, 959]

let hitArrayBindex = 0

//let thisAToWrite = false;
//let thisBToWrite = false;
//let writerA;
//let writerB;

let vid;
let hitsA = [];
let hitsB = [];
let frameToHit = 5;
let playing = true; 
let hasEnded = false;
let slider;

function setup() {
    slider = createSlider(0, 1000, timingOffset,1);
    slider.position(10, 10);
    slider.style('width', '80px');
  a = createA('https://makecode.microbit.org/_5F62ug11KMCc', 'click here and put this hex file on your micro:bit');
  
  //a.hide();
  for(let i = 0; i< 1000; i++){
    hitsA[i] = false;
    hitsB[i] = false;
  }
  createCanvas(windowWidth , windowHeight);
  
  a.position(width/2-155, height/2+160);
  a.style('color', '#ff0000');
  
  //Connect/Disconnect Buttons
  connectBtn = createButton("connect");
  connectBtn.position(width/2-180,height/2+100);
  connectBtn.mousePressed(connect);
  connectBtn.style("width:180px");
  
  disconnectBtn = createButton("disconnect");
  disconnectBtn.position(width/2,height/2+100);
  disconnectBtn.mousePressed(disconnect);
  disconnectBtn.style("width:180px");
  
  STARTBtn = createButton("START");
  STARTBtn.position(width/2-180,height/2+60);
  STARTBtn.mousePressed(START);
  STARTBtn.style("width:360px");
  STARTBtn.style("height:40px");
  
  
  
  restartBtn = createButton("restart");
  restartBtn.position(width/2-180,height/2+100);
  restartBtn.mousePressed(restart);
  restartBtn.style("width:180px");
  restartBtn.hide()
  
  exitBtn = createButton("exit");
  exitBtn.position(width/2,height/2+100);
  exitBtn.mousePressed(exit);
  exitBtn.style("width:180px");
  exitBtn.hide()
  
  unPauseBtn = createButton("unPause");
  unPauseBtn.position(width/2-180,height/2+60);
  unPauseBtn.mousePressed(unPause);
  unPauseBtn.style("width:360px");
  unPauseBtn.style("height:40px");
  unPauseBtn.hide();
  
  
  let vidUrl = "https://www.captaincredible.com/CORSETS/MBOH.mp4"
  vid = createVideo(vidUrl);
  //vid = createVideo("iwaswrong.mp4",setFrameCountOffset);
  vid.size(windowWidth, windowHeight);
  vid.volume(1);
  vid.onended(setHasEnded);
  //vid.play();
  vid.hide(); // hides the html video loader  
}

function restart(){
  hitArrayAindex = 0
  hitArrayBindex = 0
  page = "GAME";
  vid.play();
  vid.time(0);
}

function exit(){
  hitArrayAindex = 0
  hitArrayBindex = 0
  page = "SETUP";
  vid.pause()
  vid.time(0);
}

function unPause(){
  page = "GAME";
  vid.play();
}


function START(){
  vid.play();
  page = "GAME";
  hitArrayAindex = 0
  hitArrayBindex = 0
}


//should be replaced with library send 
function send(data){
  setTimeout(function() {
  if(connectedDevice != null){
  sendText = "sent: "+data; 
  uBitSend(connectedDevice,data);
  }else{
    print("device not connected!");
  }
}, timingOffset);
  
}

function handleUsbData(data){
  recvText = "recv: "+ data;
  rawData = data
  brightness = int(data);
  
}

function connect() {
  uBitConnectDevice(uBitEventHandler);
}

function disconnect() {
  //connectedDevice.close();
  uBitDisconnect(connectedDevice);

}

function setHasEnded(){
  hasEnded = true;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  connectBtn.position(width/2-180,height/2+100);
  disconnectBtn.position(width/2,height/2+100);
  STARTBtn.position(width/2-180,height/2+60);
  a.position(width/2-155, height/2+160);
  
  
}
let frameTarget= -1;
function keyPressed(){
  if(key == 's'){
  } else if (key == 'p'){
    frameTarget = thisFrame+1;
    vid.play();
  } else if (key == 'o'){
    frameTarget = -1;
    vid.play();
  } else if (key == 'r'){
    vid.time(0);
    vid.play(); 
  } else if(key == ' '){ //space
    if(page == "GAME"){
      vid.pause();
      page = "PAUSE";
    } else if(page == "PAUSE"){
      vid.play()
      page = "GAME"
    }
  }
}

function hideAllButtons(){
  connectBtn.hide();
  disconnectBtn.hide();
  STARTBtn.hide();
  exitBtn.hide();
  restartBtn.hide();
  unPauseBtn.hide();
  a.hide();
  
}

let isPaused = false;

let thisFrame = 0;
let AOpacity = 0;
let BOpacity = 0;

function draw() {
  let img = vid.get();
  let trigA = false;
  let trigB = false;
  switch(page) {
  case "SETUP":
      background("black");
      push();
      textSize(30)
      textAlign(CENTER)
      if(connectedDevice == null){
        fill("rgb(180,64,64)")
        text("connect your microbit",width/2, height/2+150);  
      } else {
        fill("rgb(70,225,134)")
        text("connected",width/2, height/2+150);
      }
      pop();
      hideAllButtons();
      a.show();
      if(connectedDevice!=null){
        STARTBtn.show();
      }
      connectBtn.show();
      disconnectBtn.show();
      
    // code block
    break;
  case "PAUSE":
      
      image(img, 0, 0,width, height); // redraws the video frame by frame 
      push();
      fill(0,0,0,150);
      rect(0,0,width,height);
      pop();
      push();
      textSize(55);
      fill("white");
      textAlign(CENTER);
      text("PAUSED", width/2, height/2);
      pop();
      hideAllButtons();
      restartBtn.show()
      unPauseBtn.show()
      exitBtn.show()

      
    break;
  case "GAME":
            if(thisFrame == frameTarget){
        vid.pause()
        
      }
      hideAllButtons();
      latencyOffset = 0.16;
      // calculate frame  and latency offset
      thisFrame = Math.abs(vid.time())*8;
      
      
      //thisFrame = vid.time()*8;  // this is where we should compensate fr latency really in time, seconds
      //thisFrame = Math.abs(thisFrame-latencyComp);  // not here
    
      
      thisFrame = Math.trunc(thisFrame);
      
      if(thisFrame < 0){
        thisFrame = 0;
      }
      
  background("black");
  
  image(img, 0, 0,width, height); // redraws theideo frame by frame in 
      
  if(fadeIn > 0 ){
    push();
    fill(0,0,0,fadeIn);
    rect(0,0,width,height);
    pop();
    fadeIn--
  }
      
  if(thisFrame >= hitArrayA[hitArrayAindex]){
    AOpacity = 255;
    hitArrayAindex++;
    trigA = true;
  }
  if(AOpacity>0){
    AOpacity-=15;
  }
  
  if(DEBUG){
  push();
  noStroke();
    fill(255,255,0,AOpacity);
    circle(width/2-200,height -60,100);
  pop();
  }
      
  if(thisFrame >= hitArrayB[hitArrayBindex]){
    BOpacity = 255;
    hitArrayBindex++;
    trigB = true;
  }
  if(BOpacity>0){
    BOpacity-=15;
  }
  
  if(DEBUG){
    push();
    noStroke();
    fill(255,255,0,BOpacity);
    circle(width/2+200,height -60,100);
    pop();  
  }
  
  
      
    break;
  default:
    // code block
}
      timingOffset = Math.trunc(slider.value());
      fill(255,255,255);
      text(timingOffset, 100,25);
      text("<-- radio delay", 130,25);
  
  if(trigA&&trigB){
    send("X"); // X means both
  } else if(trigA){
    send("A"); 
  } else if(trigB){
    send("B");
  }
  
  if(connectedDevice != null){
    push();
    fill("green");
    text("connected", 15,70);
    pop();
  } else {
    push();
    fill("red");
    text("not connected", 15,70);
    pop();
  }
    push();
    fill("rgb(104,48,255)");
    text("current frame = ", 15,50);
    text(thisFrame, 100,50);
    pop();
}