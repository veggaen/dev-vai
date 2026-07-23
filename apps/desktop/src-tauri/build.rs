use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn export_platform_constants() {
    let manifest_dir = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let constants_path = manifest_dir.join("../../../packages/constants/src/platform-values.json");
    println!("cargo:rerun-if-changed={}", constants_path.display());
    let raw = std::fs::read_to_string(&constants_path)
        .unwrap_or_else(|error| panic!("read platform constants {}: {error}", constants_path.display()));
    let manifest: serde_json::Value = serde_json::from_str(&raw)
        .unwrap_or_else(|error| panic!("parse platform constants {}: {error}", constants_path.display()));
    let runtime_port = manifest["ports"]["runtime"]
        .as_u64()
        .expect("ports.runtime must be an unsigned integer");
    let database_name = manifest["persistedNames"]["database"]
        .as_str()
        .expect("persistedNames.database must be a string");
    let build_evidence_folder = manifest["persistedNames"]["buildEvidenceFolder"]
        .as_str()
        .expect("persistedNames.buildEvidenceFolder must be a string");
    println!("cargo:rustc-env=VAI_RUNTIME_PORT={runtime_port}");
    println!("cargo:rustc-env=VAI_DATABASE_FILENAME={database_name}");
    println!("cargo:rustc-env=VAI_BUILD_EVIDENCE_FOLDER={build_evidence_folder}");
}

fn normalized_relative(root: &Path, file: &Path) -> String {
    file.strip_prefix(root)
        .expect("source path below workspace root")
        .to_string_lossy()
        .replace('\\', "/")
}

fn collect_source_files(current: &Path, files: &mut Vec<PathBuf>) {
    if current.is_file() {
        files.push(current.to_path_buf());
        return;
    }
    let mut children = std::fs::read_dir(current)
        .unwrap_or_else(|error| panic!("read source directory {}: {error}", current.display()))
        .map(|entry| entry.expect("read source directory entry").path())
        .collect::<Vec<_>>();
    children.sort();
    for child in children {
        if child.is_dir() {
            collect_source_files(&child, files);
        } else if child.is_file() {
            files.push(child);
        }
    }
}

fn ptt_source_fingerprint() -> String {
    let manifest_dir = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let root = manifest_dir.join("../../..");
    let list_path = root.join("scripts/vai-ptt-source-files.txt");
    let list = std::fs::read_to_string(&list_path).expect("read PTT source list");
    println!("cargo:rerun-if-changed={}", list_path.display());
    let mut hash = Sha256::new();
    let mut seen = BTreeSet::new();
    for relative in list.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let source_path = root.join(relative);
        println!("cargo:rerun-if-changed={}", source_path.display());
        let mut files = Vec::new();
        collect_source_files(&source_path, &mut files);
        files.sort_by_key(|file| normalized_relative(&root, file));
        for file in files {
            let normalized = normalized_relative(&root, &file);
            if !seen.insert(normalized.clone()) {
                continue;
            }
            println!("cargo:rerun-if-changed={}", file.display());
            hash.update(normalized.as_bytes());
            hash.update([0]);
            hash.update(std::fs::read(&file).unwrap_or_else(|error| {
                panic!("read PTT source file {}: {error}", file.display())
            }));
        }
    }
    format!("{:x}", hash.finalize())
}

fn main() {
    export_platform_constants();
    println!(
        "cargo:rustc-env=VAI_PTT_SOURCE_FINGERPRINT={}",
        ptt_source_fingerprint()
    );
    tauri_build::build()
}
