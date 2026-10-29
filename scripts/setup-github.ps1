param([string]$PartnerLogin='abdullahsheikhdeveloper-ops')
$ErrorActionPreference = 'Stop'
$gh = 'C:\Program Files\GitHub CLI\gh.exe'
$credentialResponse = "protocol=https`nhost=github.com`n" | git -c credential.interactive=false credential fill 2>$null
$secretLine = $credentialResponse | Where-Object { $_ -like 'password=*' }
if (-not $secretLine) { throw 'Authenticate GitHub CLI with gh auth login, then rerun this script.' }
$env:GH_TOKEN = $secretLine.Substring(9)
try {
  $login = & $gh api user --jq .login
  if ($LASTEXITCODE -ne 0 -or $login -ne 'UrwaSultana320') { throw 'Authenticated GitHub account does not match verified owner.' }
  $repo = "$login/ordercheck-ai"
  $existing = & $gh repo view $repo --json nameWithOwner,isPrivate 2>$null
  if ($LASTEXITCODE -ne 0) { & $gh repo create $repo --private --description 'Accessible evidence-aware delivery verification for blind and low-vision shoppers'; if ($LASTEXITCODE -ne 0) { throw 'Repository creation failed.' } }
  else { $details=$existing | ConvertFrom-Json; if (-not $details.isPrivate) { throw 'Existing repository is public; refusing to proceed.' } }
  $partner = $PartnerLogin
  if (-not $partner) {
    $search = & $gh api -X GET search/users -f 'q=abdullahsheikhdeveloper@gmail.com in:email' | ConvertFrom-Json
    if ($search.total_count -eq 1) { $partner=$search.items[0].login }
  }
  $invite='GitHub username required: email lookup did not identify exactly one account.'
  if($partner) { $response=& $gh api --method PUT "repos/$repo/collaborators/$partner" -f permission=push 2>&1; if($LASTEXITCODE -eq 0){$invite="Write invitation sent to $partner; acceptance not confirmed."}else{$invite="Invitation failed: $response"} }
  $milestones=@('Foundation','Order Import','Scanning and OCR','Verification Engine','Accessibility','Testing and Deployment')
  $existingMilestones=& $gh api "repos/$repo/milestones?state=all" | ConvertFrom-Json
  $issues=@(
    @('Accessible app shell and responsive navigation','Foundation','Urwa','Keyboard focus, labelled navigation and responsive layout work.'),
    @('Validated order and evidence contracts','Foundation','Abdullah','Zod rejects malformed counts; catalog data is versioned.'),
    @('Import review and corrections','Order Import','Urwa','User reviews every field before saving; missing details stay unknown.'),
    @('PDF and image extraction hardening','Order Import','Abdullah','Text/image PDFs, limits, and corrupt files recover accessibly.'),
    @('Mobile camera and spoken positioning guidance','Scanning and OCR','Urwa','Real-device permission, focus and stream cleanup tests pass.'),
    @('Barcode catalog and OCR integration','Scanning and OCR','Abdullah','Replace demonstration codes with authoritative catalog data; test label confidence.'),
    @('Evidence-aware matching and conflict recovery','Verification Engine','Abdullah','All verdict, duplicate-order, variant and size cases pass.'),
    @('Quantity tracking and undo experience','Verification Engine','Urwa','One physical unit counts once, undo recovers and completion is announced.'),
    @('VoiceOver and TalkBack acceptance','Accessibility','Urwa','A user can complete the full journey without visual instructions.'),
    @('Uncertainty and error message review','Accessibility','Abdullah','Every failure states uncertainty and gives actionable retry instructions.'),
    @('Browser and axe regression coverage','Testing and Deployment','Urwa','Desktop/mobile workflow and automated accessibility tests pass.'),
    @('CI, protection and deployment readiness','Testing and Deployment','Abdullah','Build/tests pass; Vercel preview and branch-rule limitations documented.')
  )
  $currentIssues=& $gh issue list --repo $repo --state all --limit 100 --json title | ConvertFrom-Json
  foreach($m in $milestones){if(-not($existingMilestones|Where-Object title -eq $m)){& $gh api --method POST "repos/$repo/milestones" -f "title=$m" -f 'description=See docs/roadmap.md for daily deliverables and acceptance criteria.' | Out-Null}}
  foreach($i in $issues){if($currentIssues.title -contains $i[0]){continue};$assignee=if($i[2]-eq 'Urwa'){$login}elseif($partner -and ((& $gh api "repos/$repo/collaborators/$partner/permission" --jq .permission 2>$null) -in @("write","admin","maintain"))){$partner}else{$null};$body="Responsibility: $($i[2]).`n`nAcceptance criteria: $($i[3])`n`nSee docs/roadmap.md. Abdullah assignment is pending confirmed account/access when unavailable.";$args=@('issue','create','--repo',$repo,'--title',$i[0],'--body',$body,'--milestone',$i[1]);if($assignee){$args+=@('--assignee',$assignee)};& $gh @args}
  [ordered]@{repository="https://github.com/$repo";private=$true;owner=$login;partner=$partner;invitation=$invite;protection='Not yet attempted';updated=(Get-Date -Format o)} | ConvertTo-Json | Set-Content setup-status.json
  Write-Output $invite
} finally {Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue}
