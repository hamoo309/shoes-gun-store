param([ValidateSet('start','stop','status')][string]$Action='status')
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeDir=Join-Path $projectRoot '.local'
$markerPath=Join-Path $runtimeDir 'preview-process.json'
$ownedProcess=$null
if(Test-Path -LiteralPath $markerPath){
  $marker=Get-Content -Raw -LiteralPath $markerPath | ConvertFrom-Json
  $candidate=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$marker.id) -ErrorAction SilentlyContinue
  if($candidate -and $candidate.Name -eq 'node.exe' -and $candidate.CommandLine -ceq $marker.commandLine -and $candidate.CreationDate.ToUniversalTime().Ticks.ToString() -eq $marker.createdTicks){$ownedProcess=$candidate}
}
if($Action -eq 'status'){
  if($ownedProcess){Write-Output 'SHOES GUN production preview: http://localhost:3000'}else{Write-Output 'No verified background preview is running.'}
  exit 0
}
if($Action -eq 'stop'){
  if(-not $ownedProcess){Write-Output 'No verified preview process to stop.';exit 0}
  $processes=Get-CimInstance Win32_Process
  $owned=[System.Collections.Generic.List[object]]::new();$owned.Add($ownedProcess)
  for($i=0;$i -lt $owned.Count;$i++){foreach($child in ($processes | Where-Object ParentProcessId -eq $owned[$i].ProcessId)){$owned.Add($child)}}
  for($i=$owned.Count-1;$i -ge 0;$i--){
    $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$owned[$i].ProcessId) -ErrorAction SilentlyContinue
    if($current -and $current.CreationDate -eq $owned[$i].CreationDate){Stop-Process -Id $current.ProcessId -ErrorAction SilentlyContinue}
  }
  Write-Output 'Stopped SHOES GUN preview. PostgreSQL was left running; use npm run db:stop if required.'
  exit 0
}
if($ownedProcess){Write-Output 'Preview already running: http://localhost:3000';exit 0}
if(-not (Test-Path -LiteralPath (Join-Path $projectRoot 'apps/web/.next/BUILD_ID'))){throw 'Run npm run build before starting production preview.'}
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$nodePath=(Get-Command node.exe).Source
$scriptPath=Join-Path $PSScriptRoot 'start.mjs'
$started=Start-Process -FilePath $nodePath -ArgumentList ('"'+$scriptPath+'"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'server.stdout.log') -RedirectStandardError (Join-Path $runtimeDir 'server.stderr.log') -PassThru
$verified=Get-CimInstance Win32_Process -Filter ('ProcessId='+$started.Id)
@{id=$started.Id;commandLine=$verified.CommandLine;createdTicks=$verified.CreationDate.ToUniversalTime().Ticks.ToString()} | ConvertTo-Json | Set-Content -LiteralPath $markerPath
Write-Output 'Starting SHOES GUN preview: http://localhost:3000. Use npm run preview:status or preview:stop.'
