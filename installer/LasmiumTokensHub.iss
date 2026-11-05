; Lasmium TOKENS-HUB : installeur Windows (Inno Setup 6), par utilisateur.
; Construit par `npm run package:installer` à partir de la distribution
; `dist/LasmiumTokensHub-<version>-win32-x64` (npm run package:release).
; Aucun droit administrateur : l'application s'installe dans le profil, ce qui
; permet aussi aux mises à jour automatiques signées de remplacer ses fichiers.
; Paramètres passés par scripts/build-installer.cjs : AppVersion, SourceDir,
; OutputDir, RootDir.

#ifndef AppVersion
  #error AppVersion manquant : utiliser npm run package:installer
#endif

[Setup]
AppId={{BE745A35-6D32-4C51-8DF1-5D2B2C10EB30}
AppName=Lasmium TOKENS-HUB
AppVersion={#AppVersion}
AppVerName=Lasmium TOKENS-HUB {#AppVersion}
AppPublisher=Lasmium
AppPublisherURL=https://github.com/lasme-ephrem/lasmium-tokens-bar
AppSupportURL=https://github.com/lasme-ephrem/lasmium-tokens-bar/issues
AppUpdatesURL=https://github.com/lasme-ephrem/lasmium-tokens-bar/releases
VersionInfoVersion={#AppVersion}
VersionInfoProductName=Lasmium TOKENS-HUB
VersionInfoDescription=Installation de Lasmium TOKENS-HUB
DefaultDirName={localappdata}\Programs\LasmiumTokensHub
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=LasmiumTokensHub-Setup-{#AppVersion}
SetupIconFile={#RootDir}\assets\icon.ico
UninstallDisplayIcon={app}\LasmiumTokensHub.exe
UninstallDisplayName=Lasmium TOKENS-HUB
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
; Ferme une instance ouverte avant de remplacer ses fichiers.
CloseApplications=force
RestartApplications=no

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le Bureau"; GroupDescription: "Raccourcis :"
Name: "autostart"; Description: "Lancer Lasmium TOKENS-HUB au démarrage de Windows (dans la zone de notification)"; GroupDescription: "Démarrage :"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Lasmium TOKENS-HUB"; Filename: "{app}\LasmiumTokensHub.exe"; AppUserModelID: "com.lasmium.tokenshub"
Name: "{autodesktop}\Lasmium TOKENS-HUB"; Filename: "{app}\LasmiumTokensHub.exe"; AppUserModelID: "com.lasmium.tokenshub"; Tasks: desktopicon

[Run]
; Le lancement au démarrage est enregistré par l'application elle-même (même
; valeur que la case des Réglages), puis elle quitte sans fenêtre.
Filename: "{app}\LasmiumTokensHub.exe"; Parameters: "--autostart=on"; Tasks: autostart; Flags: runhidden waituntilterminated
Filename: "{app}\LasmiumTokensHub.exe"; Parameters: "--autostart=off"; Tasks: not autostart; Flags: runhidden waituntilterminated
Filename: "{app}\LasmiumTokensHub.exe"; Description: "Lancer Lasmium TOKENS-HUB"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\LasmiumTokensHub.exe"; Parameters: "--autostart=off"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveAutostart"

[UninstallDelete]
; Fichiers ajoutés par les mises à jour automatiques et copies de secours.
Type: filesandordirs; Name: "{app}\resources"
Type: filesandordirs; Name: "{app}\locales"
Type: files; Name: "{app}\*.rollback-*"

[Code]
// À la désinstallation, les données (comptes, historique, clés chiffrées)
// sont conservées sauf demande explicite.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and DirExists(ExpandConstant('{app}\data')) then
  begin
    if UninstallSilent or (MsgBox('Supprimer aussi tes données Lasmium TOKENS-HUB (comptes connectés, historique, réglages) ?' + #13#10 + #13#10 +
      'Choisis « Non » pour les garder en vue d''une réinstallation.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) <> IDYES) then
      exit;
    DelTree(ExpandConstant('{app}'), True, True, True);
  end;
end;
