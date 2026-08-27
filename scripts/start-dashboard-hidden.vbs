' Executa start-dashboard.cmd sem abrir janela de console.
' É este arquivo que o atalho da pasta Inicializar do Windows chama.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
cmdPath = fso.BuildPath(scriptDir, "start-dashboard.cmd")

' 0 = janela oculta, False = não espera terminar
shell.Run """" & cmdPath & """", 0, False
