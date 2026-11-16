param([string]$Action='build')
$tc='C:\ncs\toolchains\dcbdc366a1'
$spec=Get-Content "$tc\environment.json" -Raw | ConvertFrom-Json
foreach($item in $spec.env_vars){
 if($item.type -eq 'relative_paths'){
  $v=($item.values | ForEach-Object { [IO.Path]::GetFullPath((Join-Path $tc $_)) }) -join ';'
  if($item.existing_value_treatment -eq 'prepend_to'){ $v+=';'+[Environment]::GetEnvironmentVariable($item.key,'Process') }
 }else{$v=$item.value}
 [Environment]::SetEnvironmentVariable($item.key,$v,'Process')
}
Set-Location C:\ncs\v3.4.0\dryspool-hapi\firmware
if($Action -eq 'build') { west build --sysbuild -b nrf7002dk/nrf5340/cpuapp/ns . -d ../build-closed-loop -- '-DEXTRA_CONF_FILE=coap.conf;coap-fota.conf;local.conf' }
elseif($Action -eq 'flash'){ west flash --no-rebuild -d ../build-closed-loop --dev-id 1050794921 }
exit $LASTEXITCODE
