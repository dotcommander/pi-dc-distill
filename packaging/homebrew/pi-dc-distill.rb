class PiDcDistill < Formula
  desc "Deterministic local context compaction extension for Pi"
  homepage "https://github.com/dotcommander/pi-dc-distill"
  url "https://registry.npmjs.org/pi-dc-distill/-/pi-dc-distill-0.2.2.tgz"
  version "0.2.2"
  # SHA-256 of the locally prepared 0.2.2 tarball; publication is pending.
  sha256 "9414d767004de581d5588be7f1973d0b0772a91918f8b716ed151b3fe40a1614"
  license "MIT"

  def install
    libexec.install Dir["*"]
  end

  def caveats
    <<~EOS
      Pi with Node.js 22.19.0 or newer must already be installed.
      Register this extension with Pi using the stable upgrade path:
        pi install "#{HOMEBREW_PREFIX}/opt/pi-dc-distill/libexec"
      Start a fresh Pi session and load only one copy of this extension.
    EOS
  end

  test do
    require "json"
    manifest = JSON.parse((libexec/"package.json").read)
    assert_equal "pi-dc-distill", manifest.fetch("name")
    assert_equal version.to_s, manifest.fetch("version")
    assert_equal ["./index.ts"], manifest.fetch("pi").fetch("extensions")
    assert_path_exists libexec/"index.ts"
    assert_path_exists libexec/"lib/local-compact.ts"
  end
end
