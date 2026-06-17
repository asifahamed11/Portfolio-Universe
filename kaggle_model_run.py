#This code i use in kaggle to run model on gpu and generate summaries in my portfolio website
import subprocess
import time
import os

# 0+1. Fix nodejs/npm + install Ollama (quiet)
print("[1/5] Fixing nodejs/npm + installing Ollama...")
!sudo apt-get remove -y libnode-dev nodejs npm > /dev/null 2>&1
!sudo apt-get autoremove -y > /dev/null 2>&1
!curl -fsSL https://deb.nodesource.com/setup_20.x 2>/dev/null | sudo -E bash - > /dev/null 2>&1
!sudo apt-get install -y nodejs zstd > /dev/null 2>&1
!curl -fsSL https://ollama.com/install.sh 2>/dev/null | sh > /dev/null 2>&1
print(f"    node {subprocess.getoutput('node -v')} / npm {subprocess.getoutput('npm -v')}")

# 2. Start Ollama server, logs suppressed
print("[2/5] Starting Ollama server...")
!pkill ollama > /dev/null 2>&1
time.sleep(2)
ollama_process = subprocess.Popen(
    ["ollama", "serve"],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL
)
time.sleep(5)

# 3. Pull Qwen 2.5 7B (keep progress bar)
print("[3/5] Pulling Qwen 2.5 7B...")
!ollama pull qwen2.5:7b

# 4. Reset & clone repo
print("[4/5] Cloning repo + installing deps...")
%cd /kaggle/working/
!rm -rf Portfolio-Universe
!git clone -q https://github.com/asifahamed11/Portfolio-Universe.git
%cd Portfolio-Universe
!npm install --silent --no-fund --no-audit > /dev/null 2>&1
print("    repo + node_modules ready")

# 5. Run summary generation
print("[5/5] Generating summaries and saving to JSON...")
!node scripts/generate-summaries.js
