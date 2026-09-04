package web

import (
	"embed"
	"io/fs"
)

// EmbeddedFS holds the compiled frontend distribution files
//go:embed index.html assets/*
var EmbeddedFS embed.FS

// GetFS returns the fs.FS for embedded frontend files
func GetFS() fs.FS {
	return EmbeddedFS
}

// HasEmbedded returns true if embedded assets contain index.html
func HasEmbedded() bool {
	_, err := EmbeddedFS.Open("index.html")
	return err == nil
}
