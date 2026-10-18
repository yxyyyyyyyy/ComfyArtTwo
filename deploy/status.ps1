Get-NetTCPConnection -State Listen -LocalPort 8188 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress
Get-Content F:\ComfyArt\logs\comfyui.err.log -Tail 35 -ErrorAction SilentlyContinue
Get-Content F:\ComfyArt\logs\download.log -Tail 12 -ErrorAction SilentlyContinue
Get-Content F:\ComfyArt\logs\download.err.log -Tail 8 -ErrorAction SilentlyContinue
Get-ScheduledTask -TaskName 'ComfyArt*' -ErrorAction SilentlyContinue | Select-Object TaskName,State | ConvertTo-Json -Compress
Get-ChildItem D:\ComfyArt-download-cache -Recurse -File -ErrorAction SilentlyContinue | Group-Object DirectoryName | ForEach-Object {
    Write-Output ($_.Name + ': cached ' + [math]::Round(($_.Group | Measure-Object Length -Sum).Sum/1GB,2) + ' GiB')
}
Get-ChildItem F:\ComfyArt\ComfyUI\models -Recurse -File -Include *.safetensors,*.part | Select-Object FullName,Length | ConvertTo-Json -Compress
