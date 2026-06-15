# Agraja IPTV Player

Agraja IPTV Player is a premium, responsive, and easy-to-use application to watch public live TV channels. It features real-time stream status checking, an interactive guide, and a high-performance video player.

## Installation

To download and install the player on your computer, open your Command Prompt or Terminal and run the single-line command below:

### For Windows (PowerShell)
This command automatically checks if Git and Node.js are installed, installs any missing prerequisites via winget, reloads the environment PATH, clones the repository, installs dependencies, creates a Desktop shortcut named **Agraja_IPTV**, and launches the application:
```powershell
if (!(Get-Command git -ErrorAction SilentlyContinue)) { Write-Host 'Installing Git...'; winget install --id Git.Git -e --silent --accept-source-agreements --accept-package-agreements }; if (!(Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Installing Node.js...'; winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements }; $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User'); git clone https://github.com/agraja38/Agraja-IPTV.git; cd Agraja-IPTV; npm install; $s = (New-Object -ComObject WScript.Shell).CreateShortcut("$Home\Desktop\Agraja_IPTV.lnk"); $s.TargetPath = "$PWD\run.bat"; $s.WorkingDirectory = "$PWD"; $s.Save(); Start-Process .\run.bat
```

### For Mac (Terminal)
This command automatically checks if Homebrew, Git, and Node.js are installed, installs any missing prerequisites, clones the repository, installs dependencies, configures file permissions, creates a double-clickable Desktop shortcut named **Agraja_IPTV**, and launches the application:
```bash
if ! command -v brew &>/dev/null; then /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" && export PATH="/opt/homebrew/bin:$PATH"; fi && if ! command -v git &>/dev/null; then brew install git; fi && if ! command -v node &>/dev/null; then brew install node; fi && git clone https://github.com/agraja38/Agraja-IPTV.git && cd Agraja-IPTV && npm install && chmod +x run.command && echo -e "#!/bin/bash\ncd \"$(pwd)\" && ./run.command" > ~/Desktop/Agraja_IPTV.command && chmod +x ~/Desktop/Agraja_IPTV.command && ./run.command
```

---

## How to Use

### For Windows Users
- **If installed via the one-line command**: Simply double-click the **Agraja_IPTV** shortcut icon on your Desktop.
- **If downloaded manually**:
  1. Double-click the `run.bat` file in the folder.
  2. The player will open automatically in your default web browser.
- When you want to stop, click the red **Quit** button at the top-right of the screen to close the app and shut down the server.

### For Mac (macOS) Users
- **If installed via the one-line command**: Simply double-click the **Agraja_IPTV** shortcut icon on your Desktop.
- **If downloaded manually**:
  1. Open your Terminal application.
  2. Navigate to the extracted folder (e.g. type `cd ` and drag the folder into the terminal).
  3. Run `chmod +x run.command` to give it launch permission.
  4. Double-click the `run.command` file inside the folder to launch the player.
- When you are finished, click the red **Quit** button at the top-right of the screen to exit and stop the server.

---

## Credits
Original IPTV playlist data and channel collections are sourced from the excellent public repository by [iptv-org](https://github.com/iptv-org/iptv).
