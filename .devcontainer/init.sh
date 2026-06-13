# The following line is needed to ensure that the "xdg-open" command is available in the container, which is required for opening links in the default browser.
[ -f "$BROWSER" ] && ! command -v xdg-open > /dev/null && sudo ln -s "$BROWSER" /usr/local/bin/xdg-open

npm install
curl -fsSL https://raw.githubusercontent.com/supabase/cli/main/install | bash