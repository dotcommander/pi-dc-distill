class PiDcDistill < Formula
  desc "Deterministic local context compaction extension for Pi"
  homepage "https://github.com/dotcommander/pi-dc-distill"
  url "https://registry.npmjs.org/pi-dc-distill/-/pi-dc-distill-0.2.0.tgz"
  version "0.2.0"
  # SHA-256 of the exact prepared npm tarball; confirm registry bytes before tap publication.
  sha256 "434c975cfb66b72dfe25dfae0a2b8d6845e3cdcbe0780b1499b3d56c026f3283"
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
