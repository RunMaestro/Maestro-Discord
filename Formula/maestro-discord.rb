class MaestroDiscord < Formula
  desc "Discord bot that bridges messages to Maestro agents"
  homepage "https://github.com/RunMaestro/Maestro-Discord"
  url "https://github.com/RunMaestro/Maestro-Discord/archive/refs/heads/main.zip"
  version "0.1.0"

  depends_on "node"

  def install
    # Install dependencies (including dev deps needed for build)
    system "npm", "install"

    # Build the project
    system "npm", "run", "build"

    # Copy built files to libexec
    libexec.install "dist", "node_modules", "package.json", "package-lock.json"

    # Create a wrapper script
    bin.mkpath
    (bin/"maestro-discord").write <<~EOS
      #!/bin/bash
      if [ -f "$DOTENV_PATH" ]; then
        set -a
        . "$DOTENV_PATH"
        set +a
      fi
      exec #{Formula["node"].opt_bin}/node #{libexec}/dist/index.js "$@"
    EOS
    (bin/"maestro-discord").chmod 0755
  end

  def post_install
    puts "
    Maestro Discord has been installed!

    Next steps:
    1. Set up your environment variables in ~/.config/maestro-discord.env
    2. Run: brew services start maestro-discord

    See: #{opt_pkgshare}/HOMEBREW_SETUP.md for detailed instructions
    "
  end

  service do
    run opt_bin/"maestro-discord"
    environment_variables PATH: "#{std_service_path_env}:/usr/local/bin",
                          DOTENV_PATH: "#{ENV['HOME']}/.config/maestro-discord.env"
    keep_alive true
    log_path var/"log/maestro-discord.log"
    error_log_path var/"log/maestro-discord-error.log"
  end
end
