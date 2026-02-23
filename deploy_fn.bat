@echo off
set SUPABASE_ACCESS_TOKEN=sbp_94894e9c1d4da93cc8abe3f9d4adf0f82a97be75
echo Deploying stripe_webhook...
npx supabase functions deploy stripe_webhook
if errorlevel 1 ( echo Deploy failed. & exit /b 1 )
echo Done!
