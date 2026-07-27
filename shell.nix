{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  buildInputs = with pkgs; [ nodejs_22 ];
  shellHook = ''
    echo "Antenna Simulator — Web Build"
    echo "  npm install     install dependencies"
    echo "  npm run dev     start dev server (localhost:5173)"
    echo "  npm run build   produce dist/ for deployment"
    echo "  docker build -t antenna-sim .   build container"
  '';
}
