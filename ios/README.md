# YouTube for iOS

An iPhone and iPad version of the Ranch YouTube app. It shows m.youtube.com in a web view and adds:

- **No ads.** Ads are removed from the player data, anything that slips through is skipped, ad and tracker requests are blocked, and sponsored cards are hidden.
- **SponsorBlock.** Skips sponsors, self-promotion and subscribe reminders (choose more in settings). Skipped parts show as marks on the progress bar, and every skip has an **Undo** button.
- **Dislike counts** from Return YouTube Dislike.
- **Background play.** Audio keeps going with the screen locked (best-effort). Picture in picture works from the full-screen player.
- **Quality of life.** It remembers your playback speed, removes the "Continue watching?" prompt, can hide Shorts (Shorts links then open in the normal player), and removes `si=` tracking from shared links.
- **Settings.** Tap the ⚙︎ in the top bar, or hold two fingers on the screen.

The desktop-only features (Discord status, tray icon, Firefox sign-in import and auto-update) are not included.

## Get the .ipa

You don't need a Mac. Unzip into the root of the `youtube-desktop` repo, so you have `ios/` and `.github/workflows/build-ipa.yml`, then push. Then use either option:

- **Actions tab → "Build iOS app (.ipa)" → Run workflow.** When it finishes, download `YouTube-iOS` from the run.
- **Push a tag such as `ios-v1.0.0`.** The .ipa is attached to that GitHub release.

The app icon is taken from `build/icon.png` automatically.

## Install

The .ipa is unsigned, so sideload it with **AltStore** or **SideStore**, which sign it with your Apple ID:

- **Free Apple ID:** the app has to be refreshed every 7 days.
- **Paid developer account:** it lasts a year.

## Build on a Mac

```
brew install xcodegen
cd ios && xcodegen generate && open RanchYouTube.xcodeproj
```

## Notes

- Google sometimes blocks sign-in inside apps. If it does, try again later or use the app signed out.
- The ad skipping, dislike button and progress-bar marks depend on YouTube's mobile page layout. If YouTube changes it, update the selectors in `App/inject.js`.
- Debugging: with iOS 16.4 or later, open Safari on a Mac and go to Develop → your iPhone → the app.
