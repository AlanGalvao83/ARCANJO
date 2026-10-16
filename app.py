import uvicorn

if __name__ == "__main__":
    print("=" * 64)
    print("  ARCANJO INTELLIGENCE — Central de Segurança Patrimonial")
    print("  Acesse no navegador: http://localhost:8000")
    print("  Documentação da API: http://localhost:8000/docs")
    print("=" * 64)
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=False)
