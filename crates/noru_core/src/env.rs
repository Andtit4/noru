//! Compile-time constants (`process.env.NODE_ENV`, `import.meta.env.*`) and `.env` loading.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

/// A value known at compile time, used for dead-branch elimination.
#[derive(Debug, Clone, PartialEq)]
pub enum StaticValue {
    Str(String),
    Num(f64),
    Bool(bool),
    Null,
    Undefined,
}

impl StaticValue {
    pub fn truthy(&self) -> bool {
        match self {
            StaticValue::Str(s) => !s.is_empty(),
            StaticValue::Num(n) => *n != 0.0 && !n.is_nan(),
            StaticValue::Bool(b) => *b,
            StaticValue::Null | StaticValue::Undefined => false,
        }
    }

    /// `===` semantics.
    pub fn strict_eq(&self, other: &StaticValue) -> bool {
        self == other
    }

    /// Loose `==` semantics for the cases we can decide safely.
    pub fn loose_eq(&self, other: &StaticValue) -> Option<bool> {
        use StaticValue::*;
        match (self, other) {
            (Null | Undefined, Null | Undefined) => Some(true),
            (Null | Undefined, _) | (_, Null | Undefined) => Some(false),
            (Str(a), Str(b)) => Some(a == b),
            (Num(a), Num(b)) => Some(a == b),
            (Bool(a), Bool(b)) => Some(a == b),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Define {
    /// JavaScript source text that replaces the expression.
    pub code: String,
    /// Statically known value, if the replacement is a scalar.
    pub value: Option<StaticValue>,
}

/// Map from dotted expression (`process.env.NODE_ENV`, `import.meta.env.MODE`) to replacement.
#[derive(Debug, Clone, Default)]
pub struct Defines {
    map: HashMap<String, Define>,
}

impl Defines {
    pub fn get(&self, key: &str) -> Option<&Define> {
        self.map.get(key)
    }

    fn insert_json(&mut self, key: &str, value: serde_json::Value) {
        let static_value = match &value {
            serde_json::Value::String(s) => Some(StaticValue::Str(s.clone())),
            serde_json::Value::Bool(b) => Some(StaticValue::Bool(*b)),
            serde_json::Value::Number(n) => n.as_f64().map(StaticValue::Num),
            serde_json::Value::Null => Some(StaticValue::Null),
            _ => None,
        };
        let mut code = value.to_string();
        if value.is_object() {
            code = format!("({code})");
        }
        self.map.insert(key.to_string(), Define { code, value: static_value });
    }

    pub fn build(mode: &str, base: &str, env: &BTreeMap<String, String>) -> Self {
        let mut defines = Defines::default();
        let node_env = if mode == "production" { "production" } else { "development" };
        defines.insert_json("process.env.NODE_ENV", node_env.into());

        let is_prod = mode == "production";
        let mut env_object = serde_json::Map::new();
        env_object.insert("MODE".into(), mode.into());
        env_object.insert("BASE_URL".into(), base.into());
        env_object.insert("PROD".into(), is_prod.into());
        env_object.insert("DEV".into(), (!is_prod).into());
        env_object.insert("SSR".into(), false.into());
        for (key, value) in env {
            env_object.insert(key.clone(), value.clone().into());
        }
        for (key, value) in &env_object {
            defines.insert_json(&format!("import.meta.env.{key}"), value.clone());
        }
        defines.insert_json("import.meta.env", serde_json::Value::Object(env_object));
        defines
    }
}

/// Prefixes of `.env` variables that are exposed to client code.
const ENV_PREFIXES: [&str; 2] = ["NORU_", "VITE_"];

/// Loads `.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local` (later files win),
/// keeping only variables with a public prefix.
pub fn load_env(root: &Path, mode: &str) -> BTreeMap<String, String> {
    let mut vars = BTreeMap::new();
    let files = [".env".to_string(), ".env.local".to_string(), format!(".env.{mode}"), format!(".env.{mode}.local")];
    for file in files {
        let Ok(text) = std::fs::read_to_string(root.join(&file)) else { continue };
        for (key, value) in parse_dotenv(&text) {
            if ENV_PREFIXES.iter().any(|p| key.starts_with(p)) {
                vars.insert(key, value);
            }
        }
    }
    // Real environment variables override files.
    for (key, value) in std::env::vars() {
        if ENV_PREFIXES.iter().any(|p| key.starts_with(p)) {
            vars.insert(key, value);
        }
    }
    vars
}

fn parse_dotenv(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else { continue };
        let key = key.trim().to_string();
        let mut value = value.trim().to_string();
        let quoted = (value.starts_with('"') && value.ends_with('"') && value.len() >= 2)
            || (value.starts_with('\'') && value.ends_with('\'') && value.len() >= 2);
        if quoted {
            let double = value.starts_with('"');
            value = value[1..value.len() - 1].to_string();
            if double {
                value = value.replace("\\n", "\n");
            }
        } else if let Some(idx) = value.find(" #") {
            value = value[..idx].trim_end().to_string();
        }
        out.push((key, value));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dotenv() {
        let vars = parse_dotenv("# c\nVITE_A=1\nexport VITE_B=\"x y\"\nVITE_C='z' \nVITE_D=v # comment\n");
        assert_eq!(
            vars,
            vec![
                ("VITE_A".into(), "1".into()),
                ("VITE_B".into(), "x y".into()),
                ("VITE_C".into(), "z".into()),
                ("VITE_D".into(), "v".into()),
            ]
        );
    }

    #[test]
    fn builds_defines() {
        let d = Defines::build("production", "/", &BTreeMap::new());
        assert_eq!(d.get("process.env.NODE_ENV").unwrap().code, "\"production\"");
        assert_eq!(d.get("import.meta.env.PROD").unwrap().value, Some(StaticValue::Bool(true)));
        assert!(d.get("import.meta.env").unwrap().code.starts_with("({"));
    }
}
