# Building an AI-Powered Robot with OrcBot: A Complete Guide

**A comprehensive, hands-on guide for students and makers who want to build an autonomous robot controlled by an AI agent.**

> **What you'll build:** A wheeled robot that receives natural-language commands over Telegram (e.g., "patrol the hallway, stop if you see an obstacle"), plans its own actions, navigates using sensors, and reports back with status updates — all orchestrated by OrcBot running on a Raspberry Pi.

---

## Table of Contents

1. [Overview & How It Works](#1-overview--how-it-works)
2. [Shopping List (Bill of Materials)](#2-shopping-list-bill-of-materials)
3. [Tools You'll Need](#3-tools-youll-need)
4. [Software Prerequisites](#4-software-prerequisites)
5. [Phase 1 — Build the Robot Chassis](#5-phase-1--build-the-robot-chassis)
6. [Phase 2 — Set Up the Raspberry Pi](#6-phase-2--set-up-the-raspberry-pi)
7. [Phase 3 — Build the Hardware Bridge](#7-phase-3--build-the-hardware-bridge)
8. [Phase 4 — Create OrcBot Skills](#8-phase-4--create-orcbot-skills)
9. [Phase 5 — Safety & Emergency Stop](#9-phase-5--safety--emergency-stop)
10. [Phase 6 — Test in Simulation First](#10-phase-6--test-in-simulation-first)
11. [Phase 7 — Connect to Real Hardware](#11-phase-7--connect-to-real-hardware)
12. [Phase 8 — Deploy & Operate](#12-phase-8--deploy--operate)
13. [Advanced: Camera Vision & Navigation](#13-advanced-camera-vision--navigation)
14. [Advanced: ROS2 Integration](#14-advanced-ros2-integration)
15. [Advanced: MQTT for Multi-Robot Fleets](#15-advanced-mqtt-for-multi-robot-fleets)
16. [Troubleshooting](#16-troubleshooting)
17. [Learning Resources](#17-learning-resources)
18. [Architecture Reference](#18-architecture-reference)

---

## 1. Overview & How It Works

### The Big Picture

Traditional robots run pre-programmed routines. What makes this project different is that **the robot thinks before it acts**. OrcBot is an AI agent — it receives a goal, breaks it into steps, executes those steps using "skills" (tools it can call), handles errors, and reports results.

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                        YOUR PHONE                              │
 │                    (Telegram / WhatsApp)                        │
 └──────────────────────────┬──────────────────────────────────────┘
                            │ "Inspect the room"
                            ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │                     ORCBOT CORE (Raspberry Pi)                  │
 │                                                                 │
 │  1. Strategic Planner  →  "I need to: move forward, check      │
 │                            sensor, turn, repeat, report"        │
 │  2. Decision Engine    →  Picks tools for each step             │
 │  3. Memory System      →  Remembers past observations           │
 │  4. Guard Rails        →  Prevents unsafe/looping actions       │
 └──────────────────────────┬──────────────────────────────────────┘
                            │ robot_move(direction="forward", speed=0.3)
                            ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │                 HARDWARE BRIDGE (Python service)                 │
 │                                                                 │
 │  • Validates commands (speed limits, range checks)              │
 │  • Translates to GPIO/I2C/serial signals                        │
 │  • Reads sensor data and returns it                             │
 │  • Emergency stop always available                              │
 └──────────────────────────┬──────────────────────────────────────┘
                            │ GPIO / I2C / Serial
                            ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │             PHYSICAL ROBOT                                      │
 │    Motors ← Motor Driver (L298N)                                │
 │    Sensors → Ultrasonic (HC-SR04) / IR / Camera                 │
 │    Power  ← Battery Pack                                        │
 └─────────────────────────────────────────────────────────────────┘
```

### Why This Architecture?

OrcBot **never touches hardware directly**. Instead, it calls a "Hardware Bridge" — a small, separate service that validates every command before sending it to motors and sensors. This gives you:

- **Safety**: The bridge enforces speed limits, timeouts, and emergency stops regardless of what the AI decides.
- **Separation**: You can test OrcBot's planning without a real robot, and test the robot without OrcBot.
- **Flexibility**: Swap the bridge from a wheeled robot to a drone to a robotic arm without changing OrcBot.

---

## 2. Shopping List (Bill of Materials)

### Core Components (Required)

| # | Component | Purpose | Est. Cost (USD) | Where to Buy |
|---|-----------|---------|-----------------|--------------|
| 1 | **Raspberry Pi 4B (4GB+)** | Runs OrcBot + bridge | $55–75 | raspberrypi.com, Amazon |
| 2 | **MicroSD Card (32GB+, Class 10)** | Pi storage | $8–12 | Amazon |
| 3 | **USB-C Power Supply (5V 3A)** | Power the Pi on your desk | $10 | Amazon |
| 4 | **2WD Robot Chassis Kit** | Frame, wheels, caster wheel | $12–20 | Amazon ("2WD robot car chassis kit") |
| 5 | **2× DC Gear Motors (3-6V)** | Drive wheels | Usually included with chassis | — |
| 6 | **L298N Motor Driver Module** | Control motor speed & direction from Pi | $3–6 | Amazon, AliExpress |
| 7 | **HC-SR04 Ultrasonic Sensor** | Obstacle detection (2cm–400cm range) | $2–4 | Amazon, AliExpress |
| 8 | **Jumper Wires (M-F, M-M, F-F)** | Connections | $5 (assorted pack) | Amazon |
| 9 | **Mini Breadboard** | Prototyping connections | $2–3 | Amazon |
| 10 | **4× AA Battery Holder + Batteries** | Power motors (6V) | $3 + $5 | Amazon |
| 11 | **USB Portable Power Bank (5V 2A+)** | Power the Pi while mobile | $15–25 | Amazon |

**Estimated core total: ~$120–160**

### Optional Upgrades

| # | Component | Purpose | Est. Cost (USD) |
|---|-----------|---------|-----------------|
| 12 | **Pi Camera Module v2 / USB webcam** | Visual inspection, navigation | $15–30 |
| 13 | **Servo Motor (SG90)** | Pan camera / arm joint | $3–5 |
| 14 | **PCA9685 Servo Driver Board** | Control multiple servos via I2C | $5–8 |
| 15 | **MPU6050 IMU Module** | Orientation/acceleration sensing | $3–5 |
| 16 | **IR Obstacle Sensors (×2)** | Edge/line detection | $2–4 |
| 17 | **OLED Display (SSD1306 128×64)** | Show status on robot | $5–8 |
| 18 | **Physical E-Stop Button** | Hardware emergency cutoff | $3–5 |
| 19 | **3D-Printed or laser-cut mount plates** | Mount Pi and sensors cleanly | $0–15 |

### What You Should Already Have

- A computer (Windows/Mac/Linux) for initial setup
- Wi-Fi network (the Pi connects to this)
- A Telegram account (for sending commands)

---

## 3. Tools You'll Need

### Physical Tools

| Tool | Why | Alternative |
|------|-----|-------------|
| **Small Phillips screwdriver** | Chassis assembly | Any small screwdriver set |
| **Wire strippers** | Prepare wires | Teeth (please don't) |
| **Soldering iron + solder** (optional) | Motor wire connections | Twist + electrical tape for prototyping |
| **Electrical tape** | Insulate connections | Heat shrink tubing |
| **Multimeter** | Debug voltage/connections | Optional but very helpful |
| **Hot glue gun** (optional) | Mount sensors on chassis | Double-sided tape, zip ties |
| **Zip ties** | Cable management | Tape |

### Software Tools (all free)

| Tool | Purpose | Install |
|------|---------|---------|
| **Raspberry Pi Imager** | Flash the Pi's SD card | [rpi.io/imager](https://www.raspberrypi.com/software/) |
| **VS Code + Remote SSH** | Edit code on the Pi from your laptop | [code.visualstudio.com](https://code.visualstudio.com) |
| **Node.js 18+** | Run OrcBot | Installed on Pi |
| **Python 3.9+** | Run the hardware bridge | Pre-installed on Pi OS |
| **Git** | Clone repos | Pre-installed on Pi OS |

---

## 4. Software Prerequisites

Before touching hardware, set up the software on your Raspberry Pi.

### 4.1 Flash Raspberry Pi OS

1. Download [Raspberry Pi Imager](https://www.raspberrypi.com/software/).
2. Insert MicroSD card into your computer.
3. In Imager, select **Raspberry Pi OS (64-bit, Lite)** — you don't need a desktop.
4. Click the gear icon (⚙) and configure:
   - **Hostname**: `orcbot-robot`
   - **Enable SSH**: Yes, with password authentication
   - **Set username/password**: `pi` / your chosen password
   - **Configure Wi-Fi**: Enter your network SSID and password
   - **Set locale**: Your timezone
5. Flash the card, insert it into the Pi, and power on.
6. Wait 2–3 minutes, then SSH in:

```bash
ssh pi@orcbot-robot.local
# If that doesn't work, find the Pi's IP via your router admin page:
# ssh pi@192.168.x.x
```

### 4.2 Install Node.js

```bash
# Install Node.js 20 LTS (required for OrcBot)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version  # Should show v20.x.x
npm --version   # Should show 10.x.x
```

### 4.3 Install OrcBot

```bash
# Clone OrcBot
cd ~
git clone https://github.com/fredabila/orcbot.git
cd orcbot

# Install dependencies
npm install

# Build
npm run build

# Create config directory
mkdir -p ~/.orcbot
```

### 4.4 Configure OrcBot

Create the config file:

```bash
nano ~/.orcbot/orcbot.config.yaml
```

Paste this minimal config:

```yaml
# ~/.orcbot/orcbot.config.yaml

# LLM Provider — pick ONE:
# Option A: OpenAI (recommended for beginners)
openaiApiKey: "sk-your-openai-key-here"
model: "gpt-4o-mini"   # Cheap and fast

# Option B: Google Gemini (free tier available)
# googleApiKey: "your-google-api-key"
# model: "gemini-2.0-flash"

# Telegram bot (get from @BotFather on Telegram)
telegramToken: "your-telegram-bot-token"

# Agent settings
maxStepsPerAction: 15
maxMessagesPerAction: 3

# Safety: require approval for elevated actions
sudoMode: false
```

### 4.5 Install Python Dependencies for the Bridge

```bash
# Install GPIO library and web framework
sudo apt-get install -y python3-pip python3-venv
python3 -m venv ~/robot-bridge-env
source ~/robot-bridge-env/bin/activate
pip install flask RPi.GPIO gpiozero
```

---

## 5. Phase 1 — Build the Robot Chassis

### 5.1 Unbox and Lay Out Parts

Your 2WD chassis kit should include:
- 2× clear acrylic plates (top and bottom)
- 2× DC gear motors with wires
- 2× wheels
- 1× caster wheel (ball or swivel)
- Screws, nuts, brass standoffs

### 5.2 Assemble Step by Step

**Step 1: Mount the motors**
1. Place the bottom acrylic plate flat on your table.
2. Attach each DC motor to the designated motor mounts on the bottom plate using the provided screws and metal brackets.
3. Motor shafts should point outward through the slots.
4. Route motor wires upward through the plate holes.

**Step 2: Attach the wheels**
1. Push fit each wheel onto a motor shaft. They should grip tightly.
2. If loose, add a small piece of tape around the shaft for grip.

**Step 3: Mount the caster wheel**
1. Attach the caster (ball) wheel to the front of the bottom plate using screws.
2. This provides a third balance point — the robot steers by differential drive (varying left/right motor speeds).

**Step 4: Add standoffs**
1. Screw the brass standoffs into the corner holes of the bottom plate.
2. These create space between the two plates for electronics.

**Step 5: Plan your layout (don't screw the top plate yet)**

On the bottom plate (between the plates), plan space for:
- L298N motor driver (center)
- Battery holder (rear, near motors)

On the top plate, plan space for:
- Raspberry Pi (center)
- Breadboard (front)
- Ultrasonic sensor (front edge, facing forward)

### 5.3 Wiring Diagram

```
                    RASPBERRY PI GPIO
                    ┌──────────────┐
                    │  3.3V  5V    │
                    │  GPIO2 5V    │
                    │  GPIO3 GND   │
                    │  GPIO4 GPIO14│
                    │  GND   GPIO15│
                    │  GPIO17 ...  │
                    │  GPIO27 ...  │
                    │  GPIO22 ...  │
                    │  3.3V  ...   │
                    │  ...   ...   │
                    └──────┬───────┘
                           │
         ┌─────────────────┼──────────────────┐
         │                 │                  │
    ULTRASONIC         L298N MOTOR         LED/BUZZER
    (HC-SR04)          DRIVER              (optional)
    ┌────────┐        ┌──────────┐
    │VCC→5V  │        │12V→Batt+ │
    │GND→GND │        │GND→Batt- │        Pi GPIO Pin → LED → GND
    │TRIG→G23│        │  & Pi GND│
    │ECHO→G24│        │IN1→GPIO17│
    │(voltage│        │IN2→GPIO27│
    │divider)│        │IN3→GPIO22│
    └────────┘        │IN4→GPIO10│
                      │ENA→GPIO18│  (PWM for speed)
                      │ENB→GPIO25│  (PWM for speed)
                      │OUT1→MotL+│
                      │OUT2→MotL-│
                      │OUT3→MotR+│
                      │OUT4→MotR-│
                      └──────────┘
```

### 5.4 Wire It Up

> **⚠️ POWER OFF EVERYTHING while wiring. Connect the battery pack LAST.**

**Motor driver (L298N) connections:**

| L298N Pin | Connect To | Purpose |
|-----------|-----------|---------|
| 12V (VCC) | Battery pack + (6V) | Power motors |
| GND | Battery pack − AND Pi GND | Common ground |
| 5V (output) | *Leave unconnected* | L298N's built-in regulator (we don't use it) |
| IN1 | Pi GPIO 17 | Left motor direction A |
| IN2 | Pi GPIO 27 | Left motor direction B |
| IN3 | Pi GPIO 22 | Right motor direction A |
| IN4 | Pi GPIO 10 | Right motor direction B |
| ENA | Pi GPIO 18 | Left motor speed (PWM) |
| ENB | Pi GPIO 25 | Right motor speed (PWM) |
| OUT1 | Left motor wire + | |
| OUT2 | Left motor wire − | |
| OUT3 | Right motor wire + | |
| OUT4 | Right motor wire − | |

> **Important**: Remove the jumper caps on ENA and ENB — this lets you control speed via PWM instead of running at full speed.

**Ultrasonic sensor (HC-SR04):**

| HC-SR04 Pin | Connect To | Notes |
|-------------|-----------|-------|
| VCC | Pi 5V | |
| GND | Pi GND | |
| TRIG | Pi GPIO 23 | |
| ECHO | Pi GPIO 24 via voltage divider | **CRITICAL**: HC-SR04 outputs 5V but Pi GPIO is 3.3V! |

**Voltage divider for ECHO pin** (protects the Pi):
```
ECHO ──── 1kΩ resistor ──┬── GPIO 24
                          │
                       2kΩ resistor
                          │
                         GND
```
This drops the 5V ECHO signal to ~3.3V. Use 1kΩ + 2kΩ (or 1kΩ + 2.2kΩ) resistors.

### 5.5 Final Assembly

1. Mount the Pi on the top plate using standoffs or double-sided tape.
2. Mount the breadboard on the top plate.
3. Mount the ultrasonic sensor on the front edge facing forward (hot glue or zip tie).
4. Screw the top plate onto the standoffs.
5. Secure the battery holder to the bottom plate.
6. Use zip ties for cable management.

---

## 6. Phase 2 — Set Up the Raspberry Pi

### 6.1 Enable GPIO Interfaces

```bash
sudo raspi-config
# Go to: Interface Options → I2C → Enable
# Go to: Interface Options → SPI → Enable
# Reboot when prompted
```

### 6.2 Test Your Wiring (Before Writing Any Bridge Code)

Create a quick test script:

```bash
nano ~/test_motors.py
```

```python
#!/usr/bin/env python3
"""Quick hardware test — run this to verify your wiring is correct."""

import RPi.GPIO as GPIO
import time

# Motor A (Left)
IN1 = 17
IN2 = 27
ENA = 18

# Motor B (Right)
IN3 = 22
IN4 = 10
ENB = 25

# Ultrasonic
TRIG = 23
ECHO = 24

GPIO.setmode(GPIO.BCM)
GPIO.setwarnings(False)

# Setup motor pins
for pin in [IN1, IN2, IN3, IN4, ENA, ENB]:
    GPIO.setup(pin, GPIO.OUT)
    GPIO.output(pin, GPIO.LOW)

# Setup ultrasonic pins
GPIO.setup(TRIG, GPIO.OUT)
GPIO.setup(ECHO, GPIO.IN)

# PWM for speed control
pwm_a = GPIO.PWM(ENA, 1000)  # 1kHz frequency
pwm_b = GPIO.PWM(ENB, 1000)
pwm_a.start(0)
pwm_b.start(0)

def test_distance():
    """Measure distance with ultrasonic sensor."""
    GPIO.output(TRIG, True)
    time.sleep(0.00001)
    GPIO.output(TRIG, False)

    start = time.time()
    stop = time.time()

    while GPIO.input(ECHO) == 0:
        start = time.time()
        if time.time() - stop > 0.1:
            return -1  # Timeout

    while GPIO.input(ECHO) == 1:
        stop = time.time()
        if stop - start > 0.1:
            return -1  # Timeout

    elapsed = stop - start
    distance_cm = (elapsed * 34300) / 2
    return round(distance_cm, 1)

def test_motor(name, in1, in2, pwm):
    """Run a single motor briefly."""
    print(f"  Testing {name} motor FORWARD...")
    GPIO.output(in1, GPIO.HIGH)
    GPIO.output(in2, GPIO.LOW)
    pwm.ChangeDutyCycle(50)  # 50% speed
    time.sleep(1)
    pwm.ChangeDutyCycle(0)
    GPIO.output(in1, GPIO.LOW)
    time.sleep(0.5)

    print(f"  Testing {name} motor REVERSE...")
    GPIO.output(in1, GPIO.LOW)
    GPIO.output(in2, GPIO.HIGH)
    pwm.ChangeDutyCycle(50)
    time.sleep(1)
    pwm.ChangeDutyCycle(0)
    GPIO.output(in2, GPIO.LOW)
    time.sleep(0.5)

try:
    print("=" * 50)
    print("ORCBOT HARDWARE TEST")
    print("=" * 50)

    # Test ultrasonic
    print("\n1. ULTRASONIC SENSOR TEST")
    for i in range(3):
        dist = test_distance()
        print(f"   Distance reading {i+1}: {dist} cm")
        time.sleep(0.5)

    # Test motors
    print("\n2. MOTOR TEST (each motor runs for 1 second)")
    input("   Press ENTER to start motor test (lift robot off ground!)...")

    test_motor("LEFT", IN1, IN2, pwm_a)
    test_motor("RIGHT", IN3, IN4, pwm_b)

    print("\n3. BOTH MOTORS FORWARD (1 second)")
    input("   Press ENTER to test both motors...")
    GPIO.output(IN1, GPIO.HIGH)
    GPIO.output(IN2, GPIO.LOW)
    GPIO.output(IN3, GPIO.HIGH)
    GPIO.output(IN4, GPIO.LOW)
    pwm_a.ChangeDutyCycle(50)
    pwm_b.ChangeDutyCycle(50)
    time.sleep(1)
    pwm_a.ChangeDutyCycle(0)
    pwm_b.ChangeDutyCycle(0)
    GPIO.output(IN1, GPIO.LOW)
    GPIO.output(IN3, GPIO.LOW)

    print("\n✅ ALL TESTS COMPLETE")
    print("If motors spun and sensor gave readings, your wiring is correct!")

except KeyboardInterrupt:
    print("\nTest interrupted")
finally:
    pwm_a.stop()
    pwm_b.stop()
    GPIO.cleanup()
```

Run it:

```bash
sudo python3 ~/test_motors.py
```

> **If motors don't spin**: Check battery connections, verify IN1-IN4 wiring, make sure ENA/ENB jumpers are removed.
>
> **If sensor reads -1**: Check TRIG/ECHO wires and the voltage divider.
>
> **If motor goes wrong direction**: Swap the two wires on that motor's OUT terminals.

---

## 7. Phase 3 — Build the Hardware Bridge

This is the critical middle layer. It's a Python REST API that accepts high-level commands from OrcBot and translates them into GPIO signals.

### 7.1 Create the Bridge Service

```bash
mkdir -p ~/robot-bridge
nano ~/robot-bridge/bridge.py
```

```python
#!/usr/bin/env python3
"""
OrcBot Hardware Bridge
======================
A REST API that safely translates OrcBot commands into GPIO signals.
OrcBot calls this service — it never touches GPIO directly.

Safety features:
  - All speeds clamped to MAX_SPEED
  - All durations clamped to MAX_DURATION
  - Watchdog: auto-stop if no command received within WATCHDOG_TIMEOUT
  - E-stop endpoint always available
  - Command logging for debugging
"""

from flask import Flask, request, jsonify
import RPi.GPIO as GPIO
import time
import threading
import logging
from datetime import datetime

app = Flask(__name__)
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('bridge')

# ─── CONFIGURATION ───────────────────────────────────────────────

# GPIO Pin Assignments (BCM numbering)
MOTOR_LEFT  = {'IN1': 17, 'IN2': 27, 'ENA': 18}
MOTOR_RIGHT = {'IN3': 22, 'IN4': 10, 'ENB': 25}
ULTRASONIC  = {'TRIG': 23, 'ECHO': 24}

# Safety Limits
MAX_SPEED = 80          # Max PWM duty cycle (0-100) — don't go 100% on cheap motors
MIN_SPEED = 20          # Below this, motors stall
MAX_DURATION = 5.0      # Max seconds for any single move command
WATCHDOG_TIMEOUT = 10   # Auto-stop if no command in N seconds
OBSTACLE_MIN_CM = 15    # Stop if obstacle closer than this

# ─── GPIO SETUP ──────────────────────────────────────────────────

GPIO.setmode(GPIO.BCM)
GPIO.setwarnings(False)

# Motor pins
for pin in [MOTOR_LEFT['IN1'], MOTOR_LEFT['IN2'],
            MOTOR_RIGHT['IN3'], MOTOR_RIGHT['IN4'],
            MOTOR_LEFT['ENA'], MOTOR_RIGHT['ENB']]:
    GPIO.setup(pin, GPIO.OUT)
    GPIO.output(pin, GPIO.LOW)

# Ultrasonic pins
GPIO.setup(ULTRASONIC['TRIG'], GPIO.OUT)
GPIO.setup(ULTRASONIC['ECHO'], GPIO.IN)

# PWM setup
pwm_left = GPIO.PWM(MOTOR_LEFT['ENA'], 1000)
pwm_right = GPIO.PWM(MOTOR_RIGHT['ENB'], 1000)
pwm_left.start(0)
pwm_right.start(0)

# ─── STATE ───────────────────────────────────────────────────────

state = {
    'moving': False,
    'direction': 'stopped',
    'speed': 0,
    'last_command_time': time.time(),
    'e_stopped': False,
    'total_commands': 0,
    'errors': 0
}

state_lock = threading.Lock()

# ─── MOTOR CONTROL ───────────────────────────────────────────────

def stop_motors():
    """Immediately stop all motors."""
    pwm_left.ChangeDutyCycle(0)
    pwm_right.ChangeDutyCycle(0)
    GPIO.output(MOTOR_LEFT['IN1'], GPIO.LOW)
    GPIO.output(MOTOR_LEFT['IN2'], GPIO.LOW)
    GPIO.output(MOTOR_RIGHT['IN3'], GPIO.LOW)
    GPIO.output(MOTOR_RIGHT['IN4'], GPIO.LOW)
    with state_lock:
        state['moving'] = False
        state['direction'] = 'stopped'
        state['speed'] = 0

def set_motors(left_speed, right_speed, left_forward=True, right_forward=True):
    """
    Set motor speeds and directions.
    Speeds are PWM duty cycles (0-100), clamped to MAX_SPEED.
    """
    with state_lock:
        if state['e_stopped']:
            log.warning("E-STOP active — ignoring motor command")
            return False

    # Clamp speeds
    left_speed = max(0, min(left_speed, MAX_SPEED))
    right_speed = max(0, min(right_speed, MAX_SPEED))

    # Left motor direction
    GPIO.output(MOTOR_LEFT['IN1'], GPIO.HIGH if left_forward else GPIO.LOW)
    GPIO.output(MOTOR_LEFT['IN2'], GPIO.LOW if left_forward else GPIO.HIGH)

    # Right motor direction
    GPIO.output(MOTOR_RIGHT['IN3'], GPIO.HIGH if right_forward else GPIO.LOW)
    GPIO.output(MOTOR_RIGHT['IN4'], GPIO.LOW if right_forward else GPIO.HIGH)

    # Set speeds
    pwm_left.ChangeDutyCycle(left_speed)
    pwm_right.ChangeDutyCycle(right_speed)

    with state_lock:
        state['moving'] = left_speed > 0 or right_speed > 0
        state['speed'] = max(left_speed, right_speed)

    return True

def measure_distance():
    """Measure distance in cm using ultrasonic sensor."""
    GPIO.output(ULTRASONIC['TRIG'], True)
    time.sleep(0.00001)
    GPIO.output(ULTRASONIC['TRIG'], False)

    start = time.time()
    timeout = start + 0.1

    while GPIO.input(ULTRASONIC['ECHO']) == 0:
        start = time.time()
        if start > timeout:
            return -1

    while GPIO.input(ULTRASONIC['ECHO']) == 1:
        stop = time.time()
        if stop > timeout:
            return -1

    elapsed = stop - start
    distance = (elapsed * 34300) / 2
    return round(distance, 1)

# ─── WATCHDOG ────────────────────────────────────────────────────

def watchdog_loop():
    """Auto-stop motors if no command received within timeout."""
    while True:
        time.sleep(1)
        with state_lock:
            if state['moving'] and not state['e_stopped']:
                elapsed = time.time() - state['last_command_time']
                if elapsed > WATCHDOG_TIMEOUT:
                    log.warning(f"WATCHDOG: No command for {elapsed:.0f}s — stopping motors")
                    stop_motors()

watchdog_thread = threading.Thread(target=watchdog_loop, daemon=True)
watchdog_thread.start()

# ─── API ENDPOINTS ───────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({'status': 'ok', 'uptime': time.time()})

@app.route('/status', methods=['GET'])
def status():
    """Get robot status including sensor readings."""
    distance = measure_distance()
    with state_lock:
        return jsonify({
            'moving': state['moving'],
            'direction': state['direction'],
            'speed': state['speed'],
            'e_stopped': state['e_stopped'],
            'obstacle_distance_cm': distance,
            'obstacle_warning': distance != -1 and distance < OBSTACLE_MIN_CM,
            'total_commands': state['total_commands'],
            'errors': state['errors'],
            'timestamp': datetime.now().isoformat()
        })

@app.route('/move', methods=['POST'])
def move():
    """
    Move the robot.
    Body: { "direction": "forward|backward|left|right", "speed": 0-100, "duration": 0-5 }
    """
    with state_lock:
        if state['e_stopped']:
            return jsonify({'error': 'E-STOP active. Call /e-stop/reset first.'}), 403
        state['last_command_time'] = time.time()
        state['total_commands'] += 1

    data = request.get_json() or {}
    direction = data.get('direction', 'forward')
    speed = data.get('speed', 40)
    duration = data.get('duration', 1.0)

    # Validate and clamp
    speed = max(MIN_SPEED, min(int(speed), MAX_SPEED))
    duration = max(0.1, min(float(duration), MAX_DURATION))

    if direction not in ('forward', 'backward', 'left', 'right'):
        return jsonify({'error': f'Invalid direction: {direction}'}), 400

    # Safety: check for obstacle before moving forward
    if direction == 'forward':
        dist = measure_distance()
        if dist != -1 and dist < OBSTACLE_MIN_CM:
            log.warning(f"OBSTACLE at {dist}cm — blocking forward move")
            return jsonify({
                'error': f'Obstacle detected at {dist}cm (minimum: {OBSTACLE_MIN_CM}cm)',
                'action': 'blocked',
                'distance_cm': dist
            }), 409

    log.info(f"MOVE: {direction} speed={speed} duration={duration}s")

    if direction == 'forward':
        set_motors(speed, speed, True, True)
        with state_lock:
            state['direction'] = 'forward'
    elif direction == 'backward':
        set_motors(speed, speed, False, False)
        with state_lock:
            state['direction'] = 'backward'
    elif direction == 'left':
        set_motors(speed * 0.3, speed, True, True)  # Slow left, full right
        with state_lock:
            state['direction'] = 'left'
    elif direction == 'right':
        set_motors(speed, speed * 0.3, True, True)  # Full left, slow right
        with state_lock:
            state['direction'] = 'right'

    # Run for duration then stop
    def auto_stop():
        time.sleep(duration)
        stop_motors()
        log.info(f"MOVE complete: {direction} for {duration}s")

    threading.Thread(target=auto_stop, daemon=True).start()

    return jsonify({
        'status': 'moving',
        'direction': direction,
        'speed': speed,
        'duration': duration
    })

@app.route('/stop', methods=['POST'])
def stop():
    """Graceful stop."""
    log.info("STOP command received")
    stop_motors()
    return jsonify({'status': 'stopped'})

@app.route('/e-stop', methods=['POST'])
def e_stop():
    """Emergency stop — cuts all motors and blocks further commands."""
    log.critical("🚨 E-STOP ACTIVATED")
    stop_motors()
    with state_lock:
        state['e_stopped'] = True
    return jsonify({'status': 'e-stopped', 'message': 'All motors stopped. Call /e-stop/reset to resume.'})

@app.route('/e-stop/reset', methods=['POST'])
def e_stop_reset():
    """Reset e-stop state to allow new commands."""
    log.info("E-STOP reset")
    with state_lock:
        state['e_stopped'] = False
    return jsonify({'status': 'reset', 'message': 'E-stop cleared. Robot can accept commands.'})

@app.route('/sensor/distance', methods=['GET'])
def sensor_distance():
    """Read ultrasonic distance sensor."""
    readings = []
    for _ in range(3):
        d = measure_distance()
        if d > 0:
            readings.append(d)
        time.sleep(0.05)

    if not readings:
        return jsonify({'error': 'Sensor timeout — check wiring'}), 500

    avg = round(sum(readings) / len(readings), 1)
    return jsonify({
        'distance_cm': avg,
        'readings': readings,
        'obstacle_warning': avg < OBSTACLE_MIN_CM
    })

@app.route('/rotate', methods=['POST'])
def rotate():
    """
    Rotate in place.
    Body: { "angle": degrees (positive=clockwise), "speed": 0-100 }
    """
    with state_lock:
        if state['e_stopped']:
            return jsonify({'error': 'E-STOP active'}), 403
        state['last_command_time'] = time.time()
        state['total_commands'] += 1

    data = request.get_json() or {}
    angle = data.get('angle', 90)
    speed = max(MIN_SPEED, min(int(data.get('speed', 40)), MAX_SPEED))

    # Estimate duration: roughly 1 second per 90 degrees at speed 40
    # This is approximate — calibrate for your specific robot!
    duration = min(abs(angle) / 90.0 * (40.0 / speed), MAX_DURATION)
    clockwise = angle > 0

    log.info(f"ROTATE: {angle}° ({'CW' if clockwise else 'CCW'}) speed={speed}")

    if clockwise:
        set_motors(speed, speed, True, False)  # Left forward, right backward
    else:
        set_motors(speed, speed, False, True)  # Left backward, right forward

    with state_lock:
        state['direction'] = 'rotating'

    def auto_stop():
        time.sleep(duration)
        stop_motors()
        log.info(f"ROTATE complete")

    threading.Thread(target=auto_stop, daemon=True).start()

    return jsonify({
        'status': 'rotating',
        'angle': angle,
        'estimated_duration': round(duration, 2)
    })

# ─── CLEANUP ─────────────────────────────────────────────────────

import atexit
import signal

def cleanup(signum=None, frame=None):
    log.info("Shutting down — stopping motors and cleaning GPIO")
    stop_motors()
    pwm_left.stop()
    pwm_right.stop()
    GPIO.cleanup()
    if signum:
        exit(0)

atexit.register(cleanup)
signal.signal(signal.SIGTERM, cleanup)
signal.signal(signal.SIGINT, cleanup)

# ─── MAIN ────────────────────────────────────────────────────────

if __name__ == '__main__':
    log.info("=" * 50)
    log.info("OrcBot Hardware Bridge starting")
    log.info(f"Safety: MAX_SPEED={MAX_SPEED}, MAX_DURATION={MAX_DURATION}s")
    log.info(f"Watchdog timeout: {WATCHDOG_TIMEOUT}s")
    log.info(f"Obstacle minimum: {OBSTACLE_MIN_CM}cm")
    log.info("=" * 50)
    app.run(host='0.0.0.0', port=5050, debug=False)
```

### 7.2 Test the Bridge

```bash
source ~/robot-bridge-env/bin/activate
sudo python3 ~/robot-bridge/bridge.py
```

In another terminal (or from your laptop):

```bash
# Health check
curl http://orcbot-robot.local:5050/health

# Read distance sensor
curl http://orcbot-robot.local:5050/sensor/distance

# Check status
curl http://orcbot-robot.local:5050/status

# Move forward (LIFT ROBOT FIRST!)
curl -X POST http://orcbot-robot.local:5050/move \
  -H "Content-Type: application/json" \
  -d '{"direction": "forward", "speed": 40, "duration": 1}'

# Emergency stop
curl -X POST http://orcbot-robot.local:5050/e-stop
```

---

## 8. Phase 4 — Create OrcBot Skills

Now we connect OrcBot to the hardware bridge by creating skills.

### 8.1 Create the Robot Skill Plugin

```bash
mkdir -p ~/.orcbot/plugins/skills/robot-control
nano ~/.orcbot/plugins/skills/robot-control/SKILL.md
```

```markdown
# robot_move

Move the robot in a direction.

## Usage

robot_move(direction, speed?, duration?)

## Parameters

- direction: "forward", "backward", "left", "right" (required)
- speed: 20-80 (default: 40)
- duration: 0.1-5.0 seconds (default: 1.0)

## Examples

- robot_move(direction="forward", speed=40, duration=2)
- robot_move(direction="left", speed=30, duration=1)

---

# robot_rotate

Rotate the robot in place.

## Usage

robot_rotate(angle, speed?)

## Parameters

- angle: degrees, positive=clockwise, negative=counter-clockwise (required)
- speed: 20-80 (default: 40)

## Examples

- robot_rotate(angle=90)  — turn right 90°
- robot_rotate(angle=-180, speed=30)  — turn around slowly

---

# robot_stop

Stop all robot movement immediately.

## Usage

robot_stop()

---

# robot_e_stop

Emergency stop — halt everything and block further commands until reset.

## Usage

robot_e_stop()

---

# robot_e_stop_reset

Reset the emergency stop so the robot can accept commands again.

## Usage

robot_e_stop_reset()

---

# robot_status

Get the robot's current status: movement state, sensor readings, obstacle warnings.

## Usage

robot_status()

---

# robot_distance

Measure the distance to the nearest obstacle using the ultrasonic sensor.

## Usage

robot_distance()
```

### 8.2 Create the Skill Handler

```bash
nano ~/.orcbot/plugins/skills/robot-control/index.js
```

```javascript
/**
 * OrcBot Robot Control Skill
 * Connects OrcBot to the Hardware Bridge REST API.
 */

const BRIDGE_URL = process.env.ROBOT_BRIDGE_URL || 'http://localhost:5050';

async function callBridge(path, method = 'GET', body = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body) options.body = JSON.stringify(body);

    try {
        const response = await fetch(`${BRIDGE_URL}${path}`, options);
        const data = await response.json();

        if (!response.ok) {
            return { success: false, error: data.error || `HTTP ${response.status}` };
        }
        return { success: true, ...data };
    } catch (e) {
        return {
            success: false,
            error: `Bridge connection failed: ${e.message}. Is the bridge running on ${BRIDGE_URL}?`
        };
    }
}

// ─── Skill Handlers ────────────────────────────────────────────

module.exports = [
    {
        name: 'robot_move',
        description: 'Move the robot in a direction (forward/backward/left/right) at a given speed for a duration. Checks for obstacles automatically.',
        usage: 'robot_move(direction, speed?, duration?)',
        handler: async (args) => {
            const direction = args.direction;
            if (!direction) return { success: false, error: 'Missing direction' };

            const speed = parseInt(args.speed || '40', 10);
            const duration = parseFloat(args.duration || '1.0');

            return callBridge('/move', 'POST', { direction, speed, duration });
        }
    },
    {
        name: 'robot_rotate',
        description: 'Rotate the robot in place by a given angle in degrees. Positive = clockwise, negative = counter-clockwise.',
        usage: 'robot_rotate(angle, speed?)',
        handler: async (args) => {
            const angle = parseInt(args.angle || '90', 10);
            const speed = parseInt(args.speed || '40', 10);
            return callBridge('/rotate', 'POST', { angle, speed });
        }
    },
    {
        name: 'robot_stop',
        description: 'Stop all robot movement immediately.',
        usage: 'robot_stop()',
        handler: async () => callBridge('/stop', 'POST')
    },
    {
        name: 'robot_e_stop',
        description: 'EMERGENCY STOP — halt all motors and block further commands until reset.',
        usage: 'robot_e_stop()',
        handler: async () => callBridge('/e-stop', 'POST')
    },
    {
        name: 'robot_e_stop_reset',
        description: 'Reset the emergency stop to allow the robot to accept commands again.',
        usage: 'robot_e_stop_reset()',
        handler: async () => callBridge('/e-stop/reset', 'POST')
    },
    {
        name: 'robot_status',
        description: 'Get the robot current status: movement state, speed, direction, obstacle distance, and any warnings.',
        usage: 'robot_status()',
        handler: async () => callBridge('/status')
    },
    {
        name: 'robot_distance',
        description: 'Measure the distance to the nearest obstacle in centimeters using the ultrasonic sensor.',
        usage: 'robot_distance()',
        handler: async () => callBridge('/sensor/distance')
    }
];
```

---

## 9. Phase 5 — Safety & Emergency Stop

**Safety is not optional in robotics.** Here are the layers built into this system:

### Layer 1: Hardware Bridge Safety (Already Built)

- **Speed clamping**: All speeds limited to `MAX_SPEED` (80%) — protects cheap motors and gears.
- **Duration clamping**: No command can run longer than `MAX_DURATION` (5s) — prevents runaways.
- **Obstacle checking**: Forward movement automatically blocked if obstacle < 15cm.
- **Watchdog timer**: Motors auto-stop if no command received within 10 seconds.
- **E-stop**: Dedicated endpoint that overrides everything.

### Layer 2: OrcBot Guard Rails (Built-In)

- **Skill frequency limits**: OrcBot can't spam the same command 15+ times.
- **Pattern loop detection**: Detects and breaks repetitive action cycles.
- **Step limits**: Actions terminate after N steps (configurable).
- **Termination review**: A second LLM pass confirms the task is actually done.

### Layer 3: Physical Safety (You Implement)

**Strongly recommended:**
- **Physical E-stop button**: Wire a normally-closed (NC) button in series with the motor battery. Pressing it cuts power to motors instantly — no software involved.
- **Battery inline fuse**: Add a 5A fuse between battery and motor driver to prevent fires.
- **Bumper switch**: Cheap microswitch on the front — triggers software stop on physical contact.

```
                          ┌─────────┐
Battery + ───── FUSE ─────┤ E-STOP  ├───── L298N 12V
                          │ (button)│
                          └─────────┘
        Normal: button closed = power flows
        Emergency: press button = power cut to motors
        Pi stays powered (uses separate USB power)
```

### Layer 4: Testing Discipline

**Follow this order — no exceptions:**

1. ✅ Test bridge API with `curl` (no motors connected)
2. ✅ Test motors individually with `test_motors.py` (robot lifted off ground)
3. ✅ Test OrcBot → bridge with robot lifted off ground
4. ✅ Test on ground in a confined space (cardboard box arena)
5. ✅ Operate normally with supervision

---

## 10. Phase 6 — Test in Simulation First

Before connecting OrcBot to real hardware, test the planning logic with a mock bridge.

### 10.1 Create a Mock Bridge

```bash
nano ~/robot-bridge/mock_bridge.py
```

```python
#!/usr/bin/env python3
"""
Mock Hardware Bridge — simulates robot behavior without GPIO.
Run this on your laptop (no Pi needed) to test OrcBot integration.
"""

from flask import Flask, request, jsonify
import time
import random
import logging

app = Flask(__name__)
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s [MOCK] %(message)s')
log = logging.getLogger('mock')

state = {
    'x': 0.0, 'y': 0.0, 'heading': 0.0,
    'moving': False, 'direction': 'stopped',
    'speed': 0, 'e_stopped': False
}

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'mock': True})

@app.route('/status', methods=['GET'])
def status():
    distance = random.uniform(20, 200)  # Simulate sensor
    return jsonify({
        'moving': state['moving'],
        'direction': state['direction'],
        'speed': state['speed'],
        'e_stopped': state['e_stopped'],
        'obstacle_distance_cm': round(distance, 1),
        'obstacle_warning': distance < 15,
        'position': {'x': round(state['x'], 2), 'y': round(state['y'], 2)},
        'heading': round(state['heading'], 1),
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S')
    })

@app.route('/move', methods=['POST'])
def move():
    if state['e_stopped']:
        return jsonify({'error': 'E-STOP active'}), 403

    data = request.get_json() or {}
    direction = data.get('direction', 'forward')
    speed = min(80, max(20, int(data.get('speed', 40))))
    duration = min(5.0, max(0.1, float(data.get('duration', 1.0))))

    # Simulate position change
    import math
    dist = speed * duration * 0.01  # Arbitrary scale
    if direction == 'forward':
        state['x'] += dist * math.cos(math.radians(state['heading']))
        state['y'] += dist * math.sin(math.radians(state['heading']))
    elif direction == 'backward':
        state['x'] -= dist * math.cos(math.radians(state['heading']))
        state['y'] -= dist * math.sin(math.radians(state['heading']))

    log.info(f"MOVE {direction} speed={speed} dur={duration:.1f}s → pos=({state['x']:.1f}, {state['y']:.1f})")
    return jsonify({'status': 'moving', 'direction': direction, 'speed': speed, 'duration': duration})

@app.route('/rotate', methods=['POST'])
def rotate():
    if state['e_stopped']:
        return jsonify({'error': 'E-STOP active'}), 403

    data = request.get_json() or {}
    angle = int(data.get('angle', 90))
    state['heading'] = (state['heading'] + angle) % 360
    log.info(f"ROTATE {angle}° → heading={state['heading']}°")
    return jsonify({'status': 'rotating', 'angle': angle, 'heading': state['heading']})

@app.route('/stop', methods=['POST'])
def stop():
    state['moving'] = False
    state['direction'] = 'stopped'
    log.info("STOP")
    return jsonify({'status': 'stopped'})

@app.route('/e-stop', methods=['POST'])
def e_stop():
    state['e_stopped'] = True
    state['moving'] = False
    log.info("🚨 E-STOP")
    return jsonify({'status': 'e-stopped'})

@app.route('/e-stop/reset', methods=['POST'])
def e_stop_reset():
    state['e_stopped'] = False
    log.info("E-STOP reset")
    return jsonify({'status': 'reset'})

@app.route('/sensor/distance', methods=['GET'])
def distance():
    d = round(random.uniform(10, 300), 1)
    return jsonify({'distance_cm': d, 'readings': [d], 'obstacle_warning': d < 15})

if __name__ == '__main__':
    log.info("Mock bridge running on port 5050")
    app.run(host='0.0.0.0', port=5050, debug=False)
```

### 10.2 Test the Full Loop

```bash
# Terminal 1: Run mock bridge
python3 ~/robot-bridge/mock_bridge.py

# Terminal 2: Run OrcBot
cd ~/orcbot
ROBOT_BRIDGE_URL=http://localhost:5050 npm run dev

# Terminal 3: Test via Telegram
# Send to your bot: "Check the robot's status"
# Send: "Move the robot forward slowly for 2 seconds"
# Send: "Patrol: move forward, check distance, turn right, repeat 3 times"
```

Watch OrcBot plan and execute multi-step sequences through the mock bridge. Fix any issues before touching real hardware.

---

## 11. Phase 7 — Connect to Real Hardware

Once mock testing works, switch to the real bridge.

### 11.1 Start the Bridge on the Pi

```bash
# On the Pi
source ~/robot-bridge-env/bin/activate
sudo python3 ~/robot-bridge/bridge.py &
```

### 11.2 Start OrcBot

```bash
cd ~/orcbot
ROBOT_BRIDGE_URL=http://localhost:5050 npm run dev
```

### 11.3 First Real-World Test (Supervised)

1. **Lift the robot off the ground** (put it on a box)
2. Send via Telegram: "Move the robot forward at speed 30 for 1 second"
3. Verify: wheels spin in the correct direction
4. Send: "Check the distance sensor"
5. Put your hand in front of the sensor — verify the reading changes
6. Send: "Emergency stop the robot"
7. Verify: motors stop, further commands are blocked
8. Send: "Reset the emergency stop"

### 11.4 Ground Test

1. Place robot on the floor in a clear area (at least 2m × 2m)
2. Place an obstacle (box, book) about 30cm ahead
3. Send: "Move forward at speed 30 for 3 seconds"
4. The robot should stop automatically when obstacle < 15cm
5. Send: "Check status" — observe the obstacle warning

---

## 12. Phase 8 — Deploy & Operate

### 12.1 Run as System Services

Create systemd services so everything starts on boot:

**Bridge service:**
```bash
sudo nano /etc/systemd/system/robot-bridge.service
```

```ini
[Unit]
Description=OrcBot Hardware Bridge
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/home/pi/robot-bridge
ExecStart=/home/pi/robot-bridge-env/bin/python bridge.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

**OrcBot service:**
```bash
sudo nano /etc/systemd/system/orcbot.service
```

```ini
[Unit]
Description=OrcBot AI Agent
After=network.target robot-bridge.service
Wants=robot-bridge.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/orcbot
ExecStart=/usr/bin/node dist/cli/index.js start
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=ROBOT_BRIDGE_URL=http://localhost:5050

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable robot-bridge orcbot
sudo systemctl start robot-bridge
sudo systemctl start orcbot

# Check status
sudo systemctl status robot-bridge
sudo systemctl status orcbot

# View logs
sudo journalctl -u robot-bridge -f
sudo journalctl -u orcbot -f
```

### 12.2 Scheduled Patrols

Use OrcBot's built-in scheduler for autonomous patrols:

```
# Via Telegram:
"Schedule a patrol every 30 minutes: move forward 3 seconds, rotate 90 degrees, 
check distance, report status back to me"
```

OrcBot will create a cron-based scheduled task that runs the patrol sequence automatically.

---

## 13. Advanced: Camera Vision & Navigation

### 13.1 Add a Camera

Connect a Pi Camera Module or USB webcam:

```bash
# For Pi Camera Module
sudo raspi-config  # Interface Options → Camera → Enable

# For USB Webcam, just plug it in

# Test it
libcamera-still -o test.jpg
# or for USB: fswebcam test.jpg
```

### 13.2 Add Camera Endpoints to the Bridge

Add these to `bridge.py`:

```python
import subprocess
import base64

@app.route('/camera/capture', methods=['GET'])
def camera_capture():
    """Capture a photo and return it as base64."""
    img_path = '/tmp/robot_capture.jpg'
    try:
        subprocess.run(
            ['libcamera-still', '-o', img_path, '--width', '640',
             '--height', '480', '-t', '1000', '--nopreview'],
            timeout=10, capture_output=True
        )
        with open(img_path, 'rb') as f:
            img_data = base64.b64encode(f.read()).decode('utf-8')
        return jsonify({
            'status': 'captured',
            'image_base64': img_data,
            'path': img_path
        })
    except Exception as e:
        return jsonify({'error': f'Camera capture failed: {e}'}), 500
```

### 13.3 Add Camera Skills to OrcBot

Add to `~/.orcbot/plugins/skills/robot-control/index.js`:

```javascript
{
    name: 'robot_look',
    description: 'Capture a photo from the robot camera and analyze what the robot can see.',
    usage: 'robot_look(prompt?)',
    handler: async (args, context) => {
        const result = await callBridge('/camera/capture');
        if (!result.success) return result;

        // Save image and use OrcBot's vision to analyze it
        const fs = require('fs');
        const path = require('path');
        const imgPath = path.join(require('os').homedir(), '.orcbot', 'robot-camera.jpg');
        const imgBuffer = Buffer.from(result.image_base64, 'base64');
        fs.writeFileSync(imgPath, imgBuffer);

        const prompt = args.prompt || 'Describe what the robot camera sees. '
            + 'Identify any obstacles, people, objects, doors, or pathways. '
            + 'Note distances if possible.';

        if (context?.agent?.llm?.analyzeMedia) {
            const analysis = await context.agent.llm.analyzeMedia(imgPath, prompt);
            return { success: true, analysis, imagePath: imgPath };
        }

        return { success: true, message: 'Photo captured', imagePath: imgPath };
    }
}
```

---

## 14. Advanced: ROS2 Integration

For more sophisticated robotics (SLAM, path planning, multi-sensor fusion), use ROS2 as the bridge layer instead of the Flask API.

### 14.1 Install ROS2 on the Pi

```bash
# ROS2 Humble on Ubuntu 22.04 for Pi
# See: https://docs.ros.org/en/humble/Installation/Ubuntu-Install-Debians.html

sudo apt install ros-humble-ros-base
source /opt/ros/humble/setup.bash
```

### 14.2 Create a ROS2 Bridge Node

```python
#!/usr/bin/env python3
"""ROS2 node that bridges OrcBot HTTP commands to ROS2 topics."""

import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist
from std_msgs.msg import Bool
from flask import Flask, request, jsonify
import threading

class OrcBotBridge(Node):
    def __init__(self):
        super().__init__('orcbot_bridge')
        self.cmd_pub = self.create_publisher(Twist, '/cmd_vel', 10)
        self.estop_pub = self.create_publisher(Bool, '/e_stop', 10)
        self.get_logger().info('OrcBot ROS2 Bridge ready')

    def move(self, linear_x, angular_z, duration):
        msg = Twist()
        msg.linear.x = float(linear_x)
        msg.angular.z = float(angular_z)
        self.cmd_pub.publish(msg)

        # Stop after duration
        def stop():
            import time
            time.sleep(duration)
            self.cmd_pub.publish(Twist())  # Zero velocity
        threading.Thread(target=stop, daemon=True).start()

    def emergency_stop(self):
        self.cmd_pub.publish(Twist())
        msg = Bool()
        msg.data = True
        self.estop_pub.publish(msg)

# ... wrap with Flask API similar to bridge.py
```

### 14.3 Topology

```
OrcBot  →  HTTP  →  ROS2 Bridge Node  →  /cmd_vel  →  Motor Driver Node
                                       →  /e_stop   →  Safety Node
                                       ←  /odom     ←  Odometry
                                       ←  /scan     ←  LIDAR (optional)
```

---

## 15. Advanced: MQTT for Multi-Robot Fleets

For controlling multiple robots from a single OrcBot instance:

### 15.1 MQTT Broker Setup

```bash
# Install Mosquitto MQTT broker
sudo apt install mosquitto mosquitto-clients

# Enable and start
sudo systemctl enable mosquitto
sudo systemctl start mosquitto
```

### 15.2 Topic Structure

```
fleet/robot-01/command       # OrcBot publishes commands here
fleet/robot-01/status        # Robot publishes telemetry here
fleet/robot-01/e-stop        # Emergency stop channel
fleet/robot-02/command       # Second robot
fleet/robot-02/status
fleet/broadcast/e-stop       # Stop ALL robots
```

### 15.3 Fleet Skill Example

```javascript
{
    name: 'fleet_command',
    description: 'Send a command to a specific robot in the fleet, or all robots.',
    usage: 'fleet_command(robot_id, command, params)',
    handler: async (args) => {
        const mqtt = require('mqtt');
        const client = mqtt.connect('mqtt://localhost');
        const topic = args.robot_id === 'all'
            ? 'fleet/broadcast/command'
            : `fleet/${args.robot_id}/command`;

        return new Promise((resolve) => {
            client.publish(topic, JSON.stringify({
                command: args.command,
                params: args.params || {},
                timestamp: Date.now()
            }), () => {
                client.end();
                resolve({ success: true, topic, command: args.command });
            });
        });
    }
}
```

---

## 16. Troubleshooting

### Common Issues

| Problem | Cause | Fix |
|---------|-------|-----|
| Motors don't spin | No battery power | Check battery connections, verify voltage with multimeter |
| Motors spin wrong direction | Wires swapped | Swap the two motor wires on L298N output terminals |
| Only one motor works | Bad connection on IN/EN pins | Check GPIO wiring, test with `test_motors.py` |
| Distance sensor reads -1 | Timeout / bad wiring | Check TRIG/ECHO pins, verify voltage divider |
| Distance reads wildly wrong | Missing voltage divider | **Add the resistor divider on ECHO** — 5V into a 3.3V GPIO can damage the Pi |
| Bridge won't start | GPIO permission | Run with `sudo` or add user to `gpio` group |
| OrcBot can't reach bridge | Wrong URL / firewall | Check `ROBOT_BRIDGE_URL`, verify with `curl localhost:5050/health` |
| Robot oscillates / stutters | Commands too rapid | Increase duration, reduce speed, check watchdog timeout |
| Blank screenshot from robot | Pi not rendering | Expected — headless Pi has no display. Use `robot_look` instead |
| OrcBot loops on commands | Task too vague | Be specific: "move forward 2 seconds" not "go somewhere" |
| Motors overheat | Speed too high / duration too long | Lower MAX_SPEED, add cooling time between moves |

### Debugging Commands

```bash
# Check if bridge is running
curl http://localhost:5050/health

# Monitor bridge logs
sudo journalctl -u robot-bridge -f

# Check GPIO pin states
gpio readall  # If wiringPi is installed
# or
python3 -c "import RPi.GPIO as GPIO; GPIO.setmode(GPIO.BCM); GPIO.setup(17, GPIO.IN); print(GPIO.input(17))"

# Test motor driver directly
python3 ~/test_motors.py

# Check I2C devices (if using PCA9685, MPU6050, etc.)
sudo i2cdetect -y 1
```

---

## 17. Learning Resources

### Beginner

| Resource | What You'll Learn |
|----------|-------------------|
| [Raspberry Pi Official Docs](https://www.raspberrypi.com/documentation/) | Pi setup, GPIO basics |
| [GPIO Zero Docs](https://gpiozero.readthedocs.io/) | Simplified Python GPIO |
| [Flask Quickstart](https://flask.palletsprojects.com/en/3.0.x/quickstart/) | Building REST APIs |
| [L298N Motor Driver Tutorial](https://lastminuteengineers.com/l298n-dc-motor-arduino-tutorial/) | Wiring and controlling DC motors |
| [HC-SR04 Ultrasonic Sensor Guide](https://tutorials-raspberrypi.com/raspberry-pi-ultrasonic-sensor-hc-sr04/) | Distance sensing |

### Intermediate

| Resource | What You'll Learn |
|----------|-------------------|
| [ROS2 Humble Tutorials](https://docs.ros.org/en/humble/Tutorials.html) | Robot Operating System |
| [MQTT Essentials](https://www.hivemq.com/mqtt-essentials/) | Publish/subscribe messaging |
| [PID Control for Robots](https://www.youtube.com/results?search_query=pid+control+robot+tutorial) | Smooth motor control |
| [OpenCV on Raspberry Pi](https://pyimagesearch.com/category/raspberry-pi/) | Computer vision |

### Advanced

| Resource | What You'll Learn |
|----------|-------------------|
| [Navigation2 (ROS2)](https://navigation.ros.org/) | Autonomous path planning |
| [SLAM Toolbox](https://github.com/SteveMacenski/slam_toolbox) | Simultaneous Localization and Mapping |
| [Isaac ROS](https://developer.nvidia.com/isaac-ros) | GPU-accelerated robotics |
| [Reinforcement Learning for Robotics](https://spinningup.openai.com/) | Teaching robots through trial and error |

### OrcBot-Specific

| Resource | What You'll Learn |
|----------|-------------------|
| [OrcBot README](https://github.com/fredabila/orcbot) | Setup, configuration, channels |
| [OrcBot Skills Guide](../skills/skill.md) | Creating custom skills |
| [OrcBot Architecture](../architecture.html) | How the agent thinks and plans |

---

## 18. Architecture Reference

### System Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                          OrcBot System                               │
│                                                                      │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────────────┐  │
│  │  Telegram /  │    │  OrcBot Core │    │  Hardware Bridge       │  │
│  │  WhatsApp /  │◄──►│              │──► │  (Flask REST API)      │  │
│  │  Discord     │    │  • Planner   │    │                        │  │
│  └─────────────┘    │  • Memory    │    │  • Command validation  │  │
│                      │  • Skills    │    │  • GPIO/I2C control    │  │
│                      │  • Guards    │    │  • Sensor reading      │  │
│                      └──────────────┘    │  • Watchdog            │  │
│                                          │  • E-stop              │  │
│                                          └───────────┬────────────┘  │
│                                                      │               │
│                                          ┌───────────▼────────────┐  │
│                                          │  Physical Hardware     │  │
│                                          │                        │  │
│                                          │  Motors ← L298N        │  │
│                                          │  Sensors → Ultrasonic  │  │
│                                          │  Camera → Pi Camera    │  │
│                                          │  Power  ← Battery      │  │
│                                          └────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### Safety Enforcement Chain

```
User Command ("move fast")
    │
    ▼
OrcBot Planner → translates to robot_move(speed=80, duration=2)
    │
    ▼
OrcBot Guard Rails → loop check, frequency check, step limit
    │
    ▼
Hardware Bridge → clamps speed to MAX_SPEED, checks obstacle
    │
    ▼
Watchdog Timer → auto-stops if no heartbeat
    │
    ▼
Physical E-Stop → cuts battery power (override everything)
```

### Data Flow for a Typical Command

```
1. User → Telegram → "Go forward and check for obstacles"
2. OrcBot Planner → Step 1: robot_status(), Step 2: robot_move(forward), Step 3: robot_distance()
3. Step 1: GET /status → {moving: false, distance: 45cm}
4. Step 2: POST /move {direction: forward, speed: 40, duration: 2}
   → Bridge: validate → check obstacle → GPIO → motors spin
5. Step 3: GET /sensor/distance → {distance: 23cm}
6. OrcBot → "Moved forward 2 seconds. Obstacle detected at 23cm ahead."
7. OrcBot → Telegram → sends message to user
```

---

## Summary

You've built a complete AI-powered robot system:

- **A physical robot** with motors, sensors, and a Raspberry Pi brain
- **A safety-first hardware bridge** that validates every command
- **OrcBot as the intelligence layer** — planning, reasoning, and communicating
- **Natural-language control** via Telegram (or WhatsApp, Discord)
- **Extensibility paths** to camera vision, ROS2, and multi-robot fleets

The key principle: **OrcBot plans, the bridge executes safely, hardware obeys.** Keep these layers separate and you can scale from a desk toy to a warehouse robot.

---

*Written by the OrcBot project. Contributions welcome at [github.com/fredabila/orcbot](https://github.com/fredabila/orcbot).*
