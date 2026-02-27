import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { logger } from '../utils/logger';

const PYTHON_ENV_DIR = path.join(process.cwd(), 'src', 'plugins', 'python-env');
const PYTHON_SCRIPTS_DIR = path.join(PYTHON_ENV_DIR, 'scripts');
const PYTHON_EXEC = process.platform === 'win32' 
    ? path.join(PYTHON_ENV_DIR, '.venv', 'Scripts', 'python.exe')
    : path.join(PYTHON_ENV_DIR, '.venv', 'bin', 'python');

/**
 * Ensures the python environment directory exists
 */
function ensureEnvDir() {
    if (!fs.existsSync(PYTHON_ENV_DIR)) {
        fs.mkdirSync(PYTHON_ENV_DIR, { recursive: true });
    }
    if (!fs.existsSync(PYTHON_SCRIPTS_DIR)) {
        fs.mkdirSync(PYTHON_SCRIPTS_DIR, { recursive: true });
    }
}

/**
 * Execute arbitrary Python code in the isolated venv
 */
export async function executePythonCodeSkill(args: any, context: any): Promise<string> {
    try {
        const code = args.code || args.script;
        const filename = args.filename || args.name;
        
        if (!code && !filename) {
            return 'Error: No Python code or filename provided. Use: execute_python_code code="print(\'hello\')" or execute_python_code filename="myscript.py"';
        }

        ensureEnvDir();

        // Check if venv exists
        if (!fs.existsSync(PYTHON_EXEC)) {
            return `Error: Python virtual environment not found at ${PYTHON_EXEC}. Please initialize it first.`;
        }

        let targetScriptPath = '';
        let isEphemeral = false;

        if (filename) {
            // Validate filename to prevent directory traversal
            const safeFilename = path.basename(filename);
            if (!safeFilename.endsWith('.py')) {
                return 'Error: Filename must end with .py';
            }
            targetScriptPath = path.join(PYTHON_SCRIPTS_DIR, safeFilename);

            if (code) {
                // If code is provided with filename, save/overwrite it
                fs.writeFileSync(targetScriptPath, code, 'utf-8');
                logger.info(`Saved python script to ${targetScriptPath}`);
            } else if (!fs.existsSync(targetScriptPath)) {
                // If only filename is provided, it must exist
                return `Error: Script '${safeFilename}' does not exist and no code was provided to create it.`;
            }
        } else {
            // Create an ephemeral temporary file for the script
            targetScriptPath = path.join(PYTHON_ENV_DIR, `temp_script_${Date.now()}.py`);
            fs.writeFileSync(targetScriptPath, code, 'utf-8');
            isEphemeral = true;
        }

        return new Promise((resolve) => {
            const pythonProcess = spawn(PYTHON_EXEC, [targetScriptPath]);
            
            let stdout = '';
            let stderr = '';

            pythonProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            pythonProcess.on('close', (code) => {
                // Cleanup if it was an ephemeral script
                if (isEphemeral) {
                    try {
                        fs.unlinkSync(targetScriptPath);
                    } catch (e) {
                        logger.warn(`Failed to cleanup temp python script: ${targetScriptPath}`);
                    }
                }

                if (code !== 0) {
                    resolve(`Python execution failed with exit code ${code}\n\nStandard Error:\n${stderr}\n\nStandard Output:\n${stdout}`);
                } else {
                    resolve(stdout || 'Execution completed successfully with no output.');
                }
            });
            
            // Timeout after 60 seconds
            setTimeout(() => {
                pythonProcess.kill();
                if (isEphemeral) {
                    try {
                        fs.unlinkSync(targetScriptPath);
                    } catch (e) {}
                }
                resolve('Error: Python execution timed out after 60 seconds.');
            }, 60000);
        });

    } catch (error) {
        logger.error(`Python execution error: ${error}`);
        return `Error executing python code: ${error}`;
    }
}

/**
 * Install a pip package in the venv
 */
export async function installPythonPackageSkill(args: any, context: any): Promise<string> {
    try {
        const packageName = args.package || args.name;
        if (!packageName) {
            return 'Error: No package name provided. Use: install_python_package package="requests"';
        }

        if (!fs.existsSync(PYTHON_EXEC)) {
            return `Error: Python virtual environment not found at ${PYTHON_EXEC}.`;
        }

        return new Promise((resolve) => {
            // pip install command
            const pipExec = process.platform === 'win32'
                ? path.join(PYTHON_ENV_DIR, '.venv', 'Scripts', 'pip.exe')
                : path.join(PYTHON_ENV_DIR, '.venv', 'bin', 'pip');

            const pipProcess = spawn(pipExec, ['install', packageName]);
            
            let stdout = '';
            let stderr = '';

            pipProcess.stdout.on('data', (data) => { stdout += data.toString(); });
            pipProcess.stderr.on('data', (data) => { stderr += data.toString(); });

            pipProcess.on('close', (code) => {
                if (code !== 0) {
                    resolve(`Pip install failed with exit code ${code}\n\nError:\n${stderr}`);
                } else {
                    resolve(`Successfully installed package '${packageName}'.\n\n${stdout}`);
                }
            });
        });

    } catch (error) {
        logger.error(`Python package installation error: ${error}`);
        return `Error installing package: ${error}`;
    }
}

// Export skill definitions
export const pythonToolsSkills = [
    {
        name: 'execute_python_code',
        description: '[ADVANCED DATA/MATH TOOL] Execute Python code in an isolated local virtual environment. ONLY use this for data analysis, complex math, or tasks requiring Python-specific libraries (pandas, numpy, etc.) after standard tools or simple TypeScript fail. Provide "code" to run it directly. Optionally provide "filename" (e.g., "script.py") to save the code for future reuse. If you only provide "filename" without "code", it will execute the previously saved script.',
        usage: "execute_python_code code=\"print('hello')\" filename=\"myscript.py\"",
        handler: executePythonCodeSkill
    },
    {
        name: 'install_python_package',
        description: '[ADVANCED TOOL DEPENDENCY] Install a Python package (via pip) into the local virtual environment. ONLY use this when you specifically need a library for the execute_python_code tool.',
        usage: 'install_python_package package="numpy"',
        handler: installPythonPackageSkill
    }
];
