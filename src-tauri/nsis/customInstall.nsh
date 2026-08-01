; Copie automatique d'un cookies.txt fourni à côté du programme d'installation.
; Charge les cookies YouTube pour débloquer l'extraction des playlists.
; Optionnel : si absent, l'installation continue normalement.
!macro CustomInstall
  ${GetExePath} $R0
  ${GetParent} $R0 $R1
  ${If} ${FileExists} "$R1\cookies.txt"
    CreateDirectory "$INSTDIR\resources"
    CopyFiles "$R1\cookies.txt" "$INSTDIR\resources\cookies.txt"
  ${EndIf}
!macroend
