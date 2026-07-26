\set ON_ERROR_STOP on

CREATE ROLE :"owner_role" LOGIN CREATEDB PASSWORD :'owner_password';
CREATE ROLE :"application_role" LOGIN PASSWORD :'application_password';
CREATE DATABASE :"database_name" OWNER :"owner_role";
