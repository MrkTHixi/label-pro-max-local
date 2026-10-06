import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute=promisify(execFile);
export async function listWindowsPrinters() {
  if(process.platform!=='win32')return [];
  const command='[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Printer | Select-Object Name,Default,WorkOffline,PrinterStatus) | ConvertTo-Json -Compress';
  const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,encoding:'utf8',timeout:15000});
  const result=stdout.trim()?JSON.parse(stdout):[];
  return (Array.isArray(result)?result:[result]).filter(Boolean).map((p)=>({name:p.Name,default:p.Default,offline:p.WorkOffline,status:p.PrinterStatus}));
}
